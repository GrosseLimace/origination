// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Pins the HTTP surface of DiagnosticsController exactly as it stood before the service-layer
/// extraction (audit finding dotnet.diagnostics-controller-bypasses-service-layer): every route,
/// its verb, its declared response type, and the controller-level attributes. A route cannot be
/// dropped, renamed, re-verbed or re-gated at the attribute level without this test changing.
/// </summary>
public class DiagnosticsControllerRouteContractTests
{
    /// <summary>The 16 routes and verbs that existed on the controller before the extraction.</summary>
    private static readonly (string Verb, string Template, string Action, int Status)[] ExpectedRoutes =
    [
        ("GET",  "connections",                    nameof(DiagnosticsController.CheckConnections),           StatusCodes.Status200OK),
        ("GET",  "ctrm",                           nameof(DiagnosticsController.GetCtrmConnectivity),        StatusCodes.Status200OK),
        ("GET",  "ctrm/contracts",                 nameof(DiagnosticsController.GetCtrmContractsForProducer), StatusCodes.Status200OK),
        ("GET",  "ctrm/alias-batch",               nameof(DiagnosticsController.GetCtrmAliasBatchSupport),   StatusCodes.Status200OK),
        ("GET",  "ctrm/producer-timing",           nameof(DiagnosticsController.GetCtrmProducerTiming),      StatusCodes.Status200OK),
        ("GET",  "tables",                         nameof(DiagnosticsController.GetTables),                  StatusCodes.Status200OK),
        ("GET",  "tableschema/{tableName}",        nameof(DiagnosticsController.GetTableWithSchema),         StatusCodes.Status200OK),
        ("GET",  "schema/{tableName}",             nameof(DiagnosticsController.GetTableSchema),             StatusCodes.Status200OK),
        ("POST", "customer-sync/run",              nameof(DiagnosticsController.RunCustomerSync),            StatusCodes.Status200OK),
        ("POST", "usage-rollups/backfill",         nameof(DiagnosticsController.BackfillUsageRollups),       StatusCodes.Status200OK),
        ("GET",  "app-access-group-members",       nameof(DiagnosticsController.GetAppAccessGroupMembers),   StatusCodes.Status200OK),
        ("POST", "commodities/seed",               nameof(DiagnosticsController.SeedCommodities),            StatusCodes.Status200OK),
        ("POST", "elevator-cache/refresh",         nameof(DiagnosticsController.RefreshElevatorCache),       StatusCodes.Status200OK),
        ("POST", "elevator-cache/geocode",         nameof(DiagnosticsController.StartElevatorGeocode),       StatusCodes.Status202Accepted),
        ("GET",  "elevator-cache/geocode-status",  nameof(DiagnosticsController.GetGeocodeStatus),           StatusCodes.Status200OK),
        ("POST", "elevator-cache/geocode-zip",     nameof(DiagnosticsController.GeocodeByZip),               StatusCodes.Status200OK),
    ];

    private static IEnumerable<MethodInfo> DeclaredPublicMethods() =>
        typeof(DiagnosticsController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName);

    // -------------------------------------------------------------------------
    [Fact]
    public void EveryPreExistingRoute_StillExists_WithTheSameVerb()
    {
        var actual = DeclaredPublicMethods()
            .Select(m =>
            {
                var http = Assert.Single(m.GetCustomAttributes<HttpMethodAttribute>(inherit: true));
                var verb = Assert.Single(http.HttpMethods);
                return (Verb: verb, Template: http.Template ?? "", Action: m.Name);
            })
            .ToHashSet();

        var expected = ExpectedRoutes.Select(r => (r.Verb, r.Template, r.Action)).ToHashSet();

        var missing = expected.Except(actual).ToList();
        var unexpected = actual.Except(expected).ToList();
        Assert.True(missing.Count == 0 && unexpected.Count == 0,
            "DiagnosticsController's routes changed." +
            (missing.Count > 0 ? "\n  Missing: " + string.Join(", ", missing) : "") +
            (unexpected.Count > 0 ? "\n  Unexpected: " + string.Join(", ", unexpected) : "") +
            "\n  Update ExpectedRoutes only for a deliberate route change.");
        Assert.Equal(16, actual.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void EveryAction_DeclaresTheSameSuccessStatus()
    {
        foreach (var (_, _, action, status) in ExpectedRoutes)
        {
            var method = typeof(DiagnosticsController).GetMethod(action)!;
            var declared = method.GetCustomAttributes<ProducesResponseTypeAttribute>().Select(a => a.StatusCode).ToList();
            Assert.Equal([status], declared);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TypedResponseDeclarations_AreUnchanged()
    {
        static Type DeclaredType(string action) =>
            typeof(DiagnosticsController).GetMethod(action)!
                .GetCustomAttribute<ProducesResponseTypeAttribute>()!.Type;

        Assert.Equal(typeof(CustomerSyncResult), DeclaredType(nameof(DiagnosticsController.RunCustomerSync)));
        Assert.Equal(typeof(AppAccessGroupMembersResponse), DeclaredType(nameof(DiagnosticsController.GetAppAccessGroupMembers)));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ControllerLevelAttributes_AreUnchanged()
    {
        var type = typeof(DiagnosticsController);

        var authorize = Assert.Single(type.GetCustomAttributes<AuthorizeAttribute>(inherit: false));
        Assert.Equal("AdminOnly", authorize.Policy);

        var route = Assert.Single(type.GetCustomAttributes<RouteAttribute>(inherit: false));
        Assert.Equal("api/[controller]", route.Template);

        Assert.NotNull(type.GetCustomAttribute<ApiControllerAttribute>());

        var produces = Assert.Single(type.GetCustomAttributes<ProducesAttribute>(inherit: false));
        Assert.Contains("application/json", produces.ContentTypes);
    }

    // -------------------------------------------------------------------------
    /// <summary>No action ever carried its own authorization override; the class policy is the whole
    /// caller-side gate (the environment gate is a runtime check, pinned in DiagnosticsControllerGateTests).</summary>
    [Fact]
    public void NoAction_OverridesTheControllerAuthorization()
    {
        foreach (var method in DeclaredPublicMethods())
        {
            Assert.Empty(method.GetCustomAttributes<AuthorizeAttribute>());
            Assert.Empty(method.GetCustomAttributes<AllowAnonymousAttribute>());
            Assert.Empty(method.GetCustomAttributes<NonActionAttribute>());
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>The query/route binding of the parameterised actions is part of the contract too.</summary>
    [Theory]
    [InlineData(nameof(DiagnosticsController.GetCtrmContractsForProducer), "scoularId", typeof(string))]
    [InlineData(nameof(DiagnosticsController.GetCtrmProducerTiming), "scoularId", typeof(string))]
    [InlineData(nameof(DiagnosticsController.GetCtrmProducerTiming), "cold", typeof(bool))]
    [InlineData(nameof(DiagnosticsController.BackfillUsageRollups), "days", typeof(int))]
    [InlineData(nameof(DiagnosticsController.RefreshElevatorCache), "geocode", typeof(bool))]
    public void QueryParameters_AreUnchanged(string action, string parameter, Type type)
    {
        var p = Assert.Single(typeof(DiagnosticsController).GetMethod(action)!.GetParameters(), p => p.Name == parameter);
        Assert.Equal(type, p.ParameterType);
        Assert.NotNull(p.GetCustomAttribute<FromQueryAttribute>());
    }

    [Theory]
    [InlineData(nameof(DiagnosticsController.GetTableWithSchema))]
    [InlineData(nameof(DiagnosticsController.GetTableSchema))]
    public void TableNameRouteParameter_IsUnchanged(string action)
    {
        var p = Assert.Single(typeof(DiagnosticsController).GetMethod(action)!.GetParameters(), p => p.Name == "tableName");
        Assert.Equal(typeof(string), p.ParameterType);
    }

    [Fact]
    public void BackfillDefaultsTo90Days_AndElevatorRefreshDefaultsToNoGeocode()
    {
        var days = typeof(DiagnosticsController).GetMethod(nameof(DiagnosticsController.BackfillUsageRollups))!
            .GetParameters().Single(p => p.Name == "days");
        Assert.Equal(90, days.DefaultValue);

        var geocode = typeof(DiagnosticsController).GetMethod(nameof(DiagnosticsController.RefreshElevatorCache))!
            .GetParameters().Single(p => p.Name == "geocode");
        Assert.Equal(false, geocode.DefaultValue);
    }
}
