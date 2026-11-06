// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Platform.Access.Controllers;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Verifies every controller in the API is protected with [Authorize].
/// This acts as a security regression test — a failing test here means
/// an endpoint was accidentally left unauthenticated.
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
}
