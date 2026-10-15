// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Authorization;
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Mobile;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Verifies every controller in the API is protected with [Authorize].
/// This acts as a security regression test — a failing test here means
/// an endpoint was accidentally left unauthenticated.
/// Controllers are discovered by reflection over BOTH the web host and the mobile assembly, so a
/// new controller in either is covered the moment it exists — the previous hand-maintained list
/// would have silently missed one.
/// </summary>
public class ControllerAuthorizationTests
{
    private static readonly Assembly[] ControllerAssemblies =
    [
        typeof(NotesController).Assembly,        // GrainOriginatorPortal.Api
        typeof(MobileAssemblyMarker).Assembly,   // GrainOriginatorPortal.Mobile
    ];

    public static IEnumerable<object[]> AllControllerTypes() =>
        ControllerAssemblies
            .SelectMany(a => a.GetTypes())
            .Where(t => t.IsClass && !t.IsAbstract && typeof(ControllerBase).IsAssignableFrom(t))
            .OrderBy(t => t.FullName)
            .Select(t => new object[] { t });

    [Fact]
    public void Discovery_FindsBothTheDesktopAndMobileSurfaces()
    {
        var types = AllControllerTypes().Select(o => (Type)o[0]).ToList();

        // Guard against the reflection sweep silently returning too little (e.g. an assembly not loaded).
        Assert.True(types.Count >= 30, $"Expected the desktop (25+) and mobile (9) controllers; found {types.Count}.");
        Assert.Contains(types, t => t == typeof(NotesController));
        Assert.Contains(types, t => t.Assembly == typeof(MobileAssemblyMarker).Assembly);
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
    /// Every usage-dashboard action reads or edits other people's activity data, so all of them
    /// must carry an explicit policy — the class-level [Authorize] alone would only require a
    /// sign-in. Reads take the UsageDashboardViewer policy (the Admin role, granted by the Super
    /// Users group); exclusion administration must stay strictly AdminOnly. The single exception is
    /// the telemetry endpoint, which every signed-in user posts to. The read policy is the whole
    /// gate: anyone who passes it sees the entire organisation and may filter by any manager.
    /// </summary>
    [Fact]
    public void UsageDashboardController_EveryActionExceptClickEvent_CarriesADashboardPolicy()
    {
        // Exclusion administration: viewers must never gain these, so AdminOnly stays mandatory.
        string[] adminOnlyActions =
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

        var missing = actions
            .Where(m => m.Name != nameof(UsageDashboardController.TrackClickEvent))
            .Where(m => !m.GetCustomAttributes<AuthorizeAttribute>(inherit: true)
                .Any(a => a.Policy == "AdminOnly" || a.Policy == UsageDashboardAccess.PolicyName))
            .Select(m => m.Name)
            .ToList();

        Assert.True(missing.Count == 0,
            $"These usage-dashboard actions are missing an explicit dashboard policy: {string.Join(", ", missing)}");

        var demoted = adminOnlyActions
            .Where(name => !actions.Single(m => m.Name == name)
                .GetCustomAttributes<AuthorizeAttribute>(inherit: true)
                .Any(a => a.Policy == "AdminOnly"))
            .ToList();

        Assert.True(demoted.Count == 0,
            $"These exclusion-administration actions must stay [Authorize(Policy = \"AdminOnly\")]: {string.Join(", ", demoted)}");

        // And the telemetry endpoint must NOT be policy-gated, or the UI stops reporting usage.
        var clickEvent = actions.Single(m => m.Name == nameof(UsageDashboardController.TrackClickEvent));
        Assert.DoesNotContain(clickEvent.GetCustomAttributes<AuthorizeAttribute>(inherit: true),
            a => a.Policy == "AdminOnly" || a.Policy == UsageDashboardAccess.PolicyName);
    }

    /// <summary>
    /// The BarChart ingestion endpoints write vendor data straight into the app database, so a plain
    /// signed-in user must not reach them: the controller carries the BarchartIngest policy (the data
    /// pipeline's application role, or an Admin) and every action inherits it. A bare [Authorize] would
    /// only require a sign-in, which is the mistake this test exists to catch.
    /// </summary>
    [Fact]
    public void BarchartIngestController_RequiresTheBarchartIngestPolicy()
    {
        var classPolicies = typeof(BarchartIngestController)
            .GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Select(a => a.Policy)
            .ToList();

        Assert.Contains("BarchartIngest", classPolicies);
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

    /// <summary>
    /// The certification ingest endpoint writes compliance data on behalf of a machine identity, so
    /// it must carry its named policy and not merely [Authorize]. A bare [Authorize] would admit any
    /// signed-in user — every employee with the app open — to an endpoint that overwrites producer
    /// certification records. That is the mistake this test exists to catch, and it is easy to make,
    /// because the class-level attribute looks protective either way.
    /// </summary>
    [Fact]
    public void OrganicCertificationIngestController_RequiresTheIngestPolicy()
    {
        var policies = typeof(OrganicCertificationIngestController)
            .GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Select(a => a.Policy)
            .ToList();

        Assert.Contains(OrganicIngestAccess.PolicyName, policies);
    }

    /// <summary>
    /// No action on the ingest controller may opt out of authentication. Pinned separately from the
    /// class attribute because [AllowAnonymous] on a single action silently overrides it.
    /// </summary>
    [Fact]
    public void OrganicCertificationIngestController_HasNoAnonymousActions()
    {
        var anonymous = typeof(OrganicCertificationIngestController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .Where(m => m.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true).Any())
            .Select(m => m.Name)
            .ToList();

        Assert.True(anonymous.Count == 0,
            $"These ingest actions allow anonymous access: {string.Join(", ", anonymous)}");
    }
}
