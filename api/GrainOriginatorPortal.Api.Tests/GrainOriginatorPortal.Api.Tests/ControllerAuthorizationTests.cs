// System namespaces
using System.Reflection;
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Platform.Access.Controllers;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Api.Modules.Producers.Controllers;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Verifies every controller in the API is protected with [Authorize], and every controller in a
/// module folder with the permissions its endpoints need.
/// This acts as a security regression test — a failing test here means
/// an endpoint was accidentally left unauthenticated or under-protected.
/// </summary>
public class ControllerAuthorizationTests
{
    public static IEnumerable<object[]> AllControllerTypes()
    {
        yield return new object[] { typeof(AccessMapController) };
        yield return new object[] { typeof(BarchartController) };
        yield return new object[] { typeof(BarchartIngestController) };
        yield return new object[] { typeof(BidSheetController) };
        yield return new object[] { typeof(ClientTelemetryController) };
        yield return new object[] { typeof(CommoditiesController) };
        yield return new object[] { typeof(ContractsController) };
        yield return new object[] { typeof(CustomersController) };
        yield return new object[] { typeof(CustomerSyncDiagnosticsController) };
        yield return new object[] { typeof(DailyRecapGroupsController) };
        yield return new object[] { typeof(DashboardPlantingEstimatesController) };
        yield return new object[] { typeof(DiagnosticsController) };
        yield return new object[] { typeof(DpContractsController) };
        yield return new object[] { typeof(EntitlementsController) };
        yield return new object[] { typeof(FdCicController) };
        yield return new object[] { typeof(CtrmSplitsController) };
        yield return new object[] { typeof(FieldPlanController) };
        yield return new object[] { typeof(GeocodeController) };
        yield return new object[] { typeof(HelpController) };
        yield return new object[] { typeof(MeController) };
        yield return new object[] { typeof(MyPermissionsController) };
        yield return new object[] { typeof(NotesController) };
        yield return new object[] { typeof(PlantingIntentionsController) };
        yield return new object[] { typeof(ProducerDetailsController) };
        yield return new object[] { typeof(QueryLibraryController) };
        yield return new object[] { typeof(RemindersController) };
        yield return new object[] { typeof(SavedListsController) };
        yield return new object[] { typeof(StoredGrainController) };
        yield return new object[] { typeof(TDiscController) };
        yield return new object[] { typeof(TeamsChannelsController) };
        yield return new object[] { typeof(TicketsController) };
        yield return new object[] { typeof(TradeUnitsController) };
        yield return new object[] { typeof(UsageDashboardController) };
        yield return new object[] { typeof(UserPreferencesController) };
        yield return new object[] { typeof(UserTradeUnitsController) };
        yield return new object[] { typeof(VersionController) };
        yield return new object[] { typeof(WhatsNewController) };
    }

    [Theory]
    [MemberData(nameof(AllControllerTypes))]
    public void Controller_HasAuthorizeAttribute(Type controllerType)
    {
        var attrs = controllerType.GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true);
        Assert.True(attrs.Length > 0,
            $"{controllerType.Name} is missing [Authorize]. All controllers must require authentication.");
    }

    [Theory]
    [MemberData(nameof(AllControllerTypes))]
    public void Controller_InheritsFromControllerBase(Type controllerType)
    {
        Assert.True(typeof(ControllerBase).IsAssignableFrom(controllerType),
            $"{controllerType.Name} must inherit from ControllerBase.");
    }

    /// <summary>
    /// The list above is kept by hand, and four controllers (ClientTelemetry, Help, TDisc,
    /// TeamsChannels) went unchecked because nobody added them (audit 2026-11-05). There is no
    /// fallback require-authenticated policy, so a controller missing from the list would go public
    /// silently if its [Authorize] were dropped. This fails the build the moment a new controller
    /// appears in the API assembly without being added above.
    /// </summary>
    [Fact]
    public void EveryControllerInTheApi_IsCoveredByTheAuthorizeCheck()
    {
        var listed = AllControllerTypes().Select(row => (Type)row[0]).ToHashSet();
        var unlisted = typeof(BarchartController).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ControllerBase).IsAssignableFrom(t))
            .Where(t => !listed.Contains(t))
            .Select(t => t.Name)
            .OrderBy(n => n)
            .ToList();

        Assert.True(unlisted.Count == 0,
            "Add these controllers to AllControllerTypes(): " + string.Join(", ", unlisted));
    }

    /// <summary>
    /// Every usage-dashboard action reads or edits other people's activity data, so each must require a
    /// permission — the class-level [Authorize] alone would only require a sign-in. Reads require
    /// usage-reports:read. Exclusion administration requires usage-exclusions:manage, which reading
    /// doesn't grant. The single exception is the telemetry endpoint, which every signed-in user posts
    /// to. The read permission is the whole gate: whoever holds it sees the entire organisation and may
    /// filter by any manager.
    /// </summary>
    [Fact]
    public void UsageDashboardController_EveryActionExceptClickEvent_RequiresItsPermission()
    {
        string[] exclusionActions =
        [
            nameof(UsageDashboardController.GetAccessUsers),
            nameof(UsageDashboardController.GetExcludedUsers),
            nameof(UsageDashboardController.AddExcludedUser),
            nameof(UsageDashboardController.RemoveExcludedUser),
        ];

        var actions = typeof(UsageDashboardController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .ToList();
        Assert.NotEmpty(actions);

        static string[] Required(MethodInfo action) =>
            action.GetCustomAttributes<RequirePermissionAttribute>(inherit: true).Select(a => a.Permission).ToArray();

        var wrong = actions
            .Where(m => m.Name != nameof(UsageDashboardController.TrackClickEvent))
            .Select(m => (m.Name, Required: Required(m), Expected: exclusionActions.Contains(m.Name)
                ? AppPermissions.UsageAnalytics.UsageExclusionsManage
                : AppPermissions.UsageAnalytics.UsageReportsRead))
            .Where(a => !a.Required.SequenceEqual([a.Expected]))
            .Select(a => $"{a.Name} requires [{string.Join(", ", a.Required)}], not {a.Expected}")
            .ToList();

        Assert.True(wrong.Count == 0, string.Join("; ", wrong));

        // And the telemetry endpoint must need only a sign-in, or the UI stops reporting usage.
        var clickEvent = actions.Single(m => m.Name == nameof(UsageDashboardController.TrackClickEvent));
        Assert.Empty(clickEvent.GetCustomAttributes<AuthorizeAttribute>(inherit: true));
    }

    /// <summary>
    /// The BarChart ingestion endpoints write vendor data straight into the app database, so a plain
    /// signed-in user must not reach them: the controller requires bid-feed:manage, which the data
    /// pipeline holds through its role row, and every action inherits it. A bare [Authorize] would only
    /// require a sign-in, which is the mistake this test exists to catch.
    /// </summary>
    [Fact]
    public void BarchartIngestController_RequiresBidFeedManage()
    {
        var required = typeof(BarchartIngestController)
            .GetCustomAttributes<RequirePermissionAttribute>(inherit: true)
            .Select(a => a.Permission);

        Assert.Equal(new[] { AppPermissions.BidSheet.BidFeedManage }, required);
    }

    /// <summary>
    /// The class-level policy only holds if no action opts out of it, so no ingest endpoint may carry
    /// [AllowAnonymous].
    /// </summary>
    [Fact]
    public void BarchartIngestController_NoActionAllowsAnonymousAccess()
    {
        var actions = typeof(BarchartIngestController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .ToList();

        Assert.NotEmpty(actions);

        var anonymous = actions
            .Where(m => m.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true).Any())
            .Select(m => m.Name)
            .ToList();

        Assert.True(anonymous.Count == 0,
            $"These BarChart ingest actions allow anonymous access: {string.Join(", ", anonymous)}");

        Assert.Empty(typeof(BarchartIngestController).GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
    }

    // -------------------------------------------------------------------------------------------------
    // A permission on every endpoint, checked module by module.
    //
    // These checks cover the controllers in Api.Platform and Api.Modules.<Module>. A controller still in
    // the old Controllers folder is skipped until its module moves, so moving a module is what turns the
    // checks on for it.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Controllers any signed-in user may call, so they need no permission: who you are and what you may
    /// do, the version, help, What's New and the browser's telemetry settings.
    /// </summary>
    private static readonly HashSet<Type> OpenToAnySignedInUser =
    [
        typeof(MeController),
        typeof(MyPermissionsController),
        typeof(VersionController),
        typeof(HelpController),
        typeof(WhatsNewController),
        typeof(ClientTelemetryController),
    ];

    /// <summary>POSTs that store no business data, so the controller's read permission is enough.</summary>
    private static readonly HashSet<(Type Controller, string Action)> NonMutatingPosts =
    [
        (typeof(FdCicController), nameof(FdCicController.Score)),                // scores a field, stores nothing
        (typeof(GeocodeController), nameof(GeocodeController.SingleGeocode)),    // address lookups, store nothing
        (typeof(GeocodeController), nameof(GeocodeController.BatchGeocode)),
        (typeof(QueryLibraryController), nameof(QueryLibraryController.LogSearch)), // records telemetry only
    ];

    private const string PlatformNamespace = "GrainOriginatorPortal.Api.Platform";
    private const string ModulesNamespace = "GrainOriginatorPortal.Api.Modules.";

    /// <summary>
    /// The module a controller's folder puts it in: <c>platform</c> under <c>Api.Platform</c>, or the
    /// folder under <c>Api.Modules</c> in kebab case (<c>Modules.BidSheet</c> is <c>bid-sheet</c>), the
    /// same ids <see cref="AppPermissions.ModuleOf"/> uses. Null while the controller is still in the old
    /// Controllers folder.
    /// </summary>
    private static string? ModuleOf(Type controller)
    {
        var ns = controller.Namespace ?? string.Empty;
        if (ns == PlatformNamespace || ns.StartsWith(PlatformNamespace + ".", StringComparison.Ordinal))
        {
            return "platform";
        }

        if (!ns.StartsWith(ModulesNamespace, StringComparison.Ordinal))
        {
            return null;
        }

        var folder = ns[ModulesNamespace.Length..].Split('.')[0];
        return Regex.Replace(folder, "(?<!^)([A-Z])", "-$1").ToLowerInvariant();
    }

    private static List<(Type Controller, string Module)> ModuleControllers() =>
        AllControllerTypes()
            .Select(row => (Type)row[0])
            .Select(type => (Controller: type, Module: ModuleOf(type)))
            .Where(c => c.Module is not null)
            .Select(c => (c.Controller, c.Module!))
            .ToList();

    private static IEnumerable<(Type Controller, MethodInfo Action)> ActionsOf(IEnumerable<Type> controllers) =>
        controllers.SelectMany(controller => controller
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName && !m.IsDefined(typeof(NonActionAttribute), inherit: true))
            .Select(action => (controller, action)));

    private static IEnumerable<string> PermissionsOn(MemberInfo member) =>
        member.GetCustomAttributes<RequirePermissionAttribute>(inherit: true).Select(a => a.Permission);

    /// <summary>Anything but GET or HEAD. An action without a verb attribute answers every verb, POST included.</summary>
    private static bool ChangesData(MethodInfo action)
    {
        var verbs = action.GetCustomAttributes(inherit: true)
            .OfType<IActionHttpMethodProvider>()
            .SelectMany(provider => provider.HttpMethods)
            .ToList();

        return verbs.Count == 0 || verbs.Any(verb => verb is not ("GET" or "HEAD"));
    }

    /// <summary><c>write</c>, <c>manage</c>, or a scoped <c>delete</c> such as <c>bid-sheet-locations:delete:global</c>.</summary>
    private static bool IsWrite(string permission) => permission.Split(':')[1] is "write" or "manage" or "delete";

    [Fact]
    public void TheModuleChecks_FindTheControllersAlreadyInPlatform()
    {
        // If the namespace test above ever stops matching, every check below would pass on nothing.
        var found = ModuleControllers().Select(c => c.Controller).ToList();

        Assert.Contains(typeof(AccessMapController), found);
        Assert.Contains(typeof(MyPermissionsController), found);
    }

    [Fact]
    public void ModuleControllers_SitInAModuleTheCatalogKnows()
    {
        // A folder name that isn't a module (Modules/Producer, say) would leave its controllers with no
        // permissions of their own to require.
        var modules = AppPermissions.ModuleOf.Values.ToHashSet(StringComparer.Ordinal);
        var unknown = ModuleControllers()
            .Where(c => !modules.Contains(c.Module))
            .Select(c => $"{c.Controller.Name} ({c.Module})")
            .ToList();

        Assert.True(unknown.Count == 0,
            "These controllers sit in a folder that isn't a module in AppPermissions: " + string.Join(", ", unknown));
    }

    [Fact]
    public void ModuleControllers_CarryAClassLevelPermission_FromTheirOwnModuleOnly()
    {
        // The class-level permission, normally the module's read, applies to every action, so a write needs
        // it as well as its own write permission. The add-on roles rely on that: Editor grants writes
        // everywhere, and only the persona roles' reads decide where those writes can be used. A class-level
        // permission from another module would make the whole controller depend on that module.
        var wrong = ModuleControllers()
            .Where(c => !OpenToAnySignedInUser.Contains(c.Controller))
            .Select(c => (c.Controller, c.Module, Required: PermissionsOn(c.Controller).ToList()))
            .Where(c => c.Required.Count == 0
                        || c.Required.Any(p => AppPermissions.ModuleOf.GetValueOrDefault(p) != c.Module))
            .Select(c => $"{c.Controller.Name} requires [{string.Join(", ", c.Required)}] on the class; "
                         + $"it needs at least one, all from the {c.Module} module")
            .ToList();

        Assert.True(wrong.Count == 0, string.Join("; ", wrong));
    }

    [Fact]
    public void ModuleControllers_RequireAPermissionOnEveryAction()
    {
        var guarded = ModuleControllers().Select(c => c.Controller).Where(c => !OpenToAnySignedInUser.Contains(c));
        var open = ActionsOf(guarded)
            .Where(a => !PermissionsOn(a.Controller).Concat(PermissionsOn(a.Action)).Any())
            .Select(a => $"{a.Controller.Name}.{a.Action.Name}")
            .ToList();

        Assert.True(open.Count == 0, "These actions need only a sign-in: " + string.Join(", ", open));
    }

    [Fact]
    public void ModuleControllers_RequireAWritePermission_OnEveryActionThatChangesData()
    {
        // A read permission on a POST, PUT or DELETE would let a read-only user change data.
        var guarded = ModuleControllers().Select(c => c.Controller).Where(c => !OpenToAnySignedInUser.Contains(c));
        var readOnly = ActionsOf(guarded)
            .Where(a => ChangesData(a.Action) && !NonMutatingPosts.Contains((a.Controller, a.Action.Name)))
            .Where(a => !PermissionsOn(a.Controller).Concat(PermissionsOn(a.Action)).Any(IsWrite))
            .Select(a => $"{a.Controller.Name}.{a.Action.Name}")
            .ToList();

        Assert.True(readOnly.Count == 0,
            "These actions change data but need no write or manage permission: " + string.Join(", ", readOnly));
    }

    [Fact]
    public void ControllersOpenToAnySignedInUser_OnlyRead()
    {
        // They need no permission, so an action that changes data would be open to every signed-in user.
        var writes = ActionsOf(OpenToAnySignedInUser)
            .Where(a => ChangesData(a.Action))
            .Select(a => $"{a.Controller.Name}.{a.Action.Name}")
            .ToList();

        Assert.True(writes.Count == 0,
            "Move these to a controller that requires a permission: " + string.Join(", ", writes));
    }

    [Fact]
    public void ModuleControllers_AllowNoAnonymousAccess()
    {
        // [AllowAnonymous] would skip the permission and the sign-in alike.
        var controllers = ModuleControllers().Select(c => c.Controller).ToList();
        var anonymous = controllers
            .Where(c => c.IsDefined(typeof(AllowAnonymousAttribute), inherit: true))
            .Select(c => c.Name)
            .Concat(ActionsOf(controllers)
                .Where(a => a.Action.IsDefined(typeof(AllowAnonymousAttribute), inherit: true))
                .Select(a => $"{a.Controller.Name}.{a.Action.Name}"))
            .ToList();

        Assert.True(anonymous.Count == 0, "These allow anonymous access: " + string.Join(", ", anonymous));
    }
}
