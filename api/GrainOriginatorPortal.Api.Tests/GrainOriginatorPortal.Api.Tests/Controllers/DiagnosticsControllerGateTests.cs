// Microsoft namespaces
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Services.Diagnostics;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Pins the runtime behaviour the controller kept after the service extraction: which routes are
/// behind which environment gate, that a denied request never reaches a service, the request
/// validation that answers 400 before any service call, and the 202/409 mapping of the background
/// geocode. The three gate families are exactly those of the pre-extraction controller:
/// <list type="bullet">
/// <item>DenyIfNotDevelopment (Development or QA only): connections, tables, tableschema, schema,
/// commodities/seed, elevator-cache/*.</item>
/// <item>DenyIfProduction (Development, Dev or QA): the four ctrm probes.</item>
/// <item>Ungated: usage-rollups/backfill, app-access-group-members. (customer-sync/run moved to
/// CustomerSyncDiagnosticsController, which has its own gate tests.)</item>
/// </list>
/// </summary>
public class DiagnosticsControllerGateTests
{
    private readonly Mock<ISchemaDiagnosticsService> _schema;
    private readonly Mock<ICtrmDiagnosticsService> _ctrm;
    private readonly Mock<ICommoditySeedService> _commoditySeed;
    private readonly Mock<IElevatorCacheDiagnosticsService> _elevatorCache;
    private readonly Mock<IUsageRollupBackfillService> _usageRollups;
    private readonly Mock<IAppAccessDiagnosticsService> _appAccess;

    public DiagnosticsControllerGateTests()
    {
        // Strict: a denied request must not touch a service at all. Tests that expect a call
        // set it up explicitly.
        _schema = new Mock<ISchemaDiagnosticsService>(MockBehavior.Strict);
        _ctrm = new Mock<ICtrmDiagnosticsService>(MockBehavior.Strict);
        _commoditySeed = new Mock<ICommoditySeedService>(MockBehavior.Strict);
        _elevatorCache = new Mock<IElevatorCacheDiagnosticsService>(MockBehavior.Strict);
        _usageRollups = new Mock<IUsageRollupBackfillService>(MockBehavior.Strict);
        _appAccess = new Mock<IAppAccessDiagnosticsService>(MockBehavior.Strict);
    }

    private DiagnosticsController CreateSut(string environmentName)
    {
        var env = new Mock<IWebHostEnvironment>();
        env.Setup(e => e.EnvironmentName).Returns(environmentName);

        return new DiagnosticsController(
            env.Object,
            _schema.Object,
            _ctrm.Object,
            _commoditySeed.Object,
            _elevatorCache.Object,
            _usageRollups.Object,
            _appAccess.Object);
    }

    /// <summary>Every action behind DenyIfNotDevelopment, invoked with valid arguments.</summary>
    private static IEnumerable<Func<DiagnosticsController, Task<IActionResult>>> DevOrQaOnlyActions()
    {
        yield return c => c.CheckConnections();
        yield return c => c.GetTables();
        yield return c => c.GetTableWithSchema("Customer");
        yield return c => c.GetTableSchema("Customer");
        yield return c => c.SeedCommodities();
        yield return c => c.RefreshElevatorCache();
        yield return c => Task.FromResult(c.StartElevatorGeocode());
        yield return c => c.GetGeocodeStatus();
        yield return c => c.GeocodeByZip();
    }

    /// <summary>Every action behind DenyIfProduction, invoked with valid arguments.</summary>
    private static IEnumerable<Func<DiagnosticsController, Task<IActionResult>>> NonProductionActions()
    {
        yield return c => c.GetCtrmConnectivity();
        yield return c => c.GetCtrmContractsForProducer("TATOBIN");
        yield return c => c.GetCtrmAliasBatchSupport();
        yield return c => c.GetCtrmProducerTiming("TATOBIN");
    }

    private void SetUpEveryServiceToSucceed()
    {
        _schema.Setup(s => s.CheckConnectionsAsync()).ReturnsAsync([]);
        _schema.Setup(s => s.GetTablesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TableListResult("db", 0, []));
        _schema.Setup(s => s.GetTableWithSchemaAsync("Customer", It.IsAny<CancellationToken>())).ReturnsAsync([]);
        _schema.Setup(s => s.GetTableSchemaAsync("Customer", It.IsAny<CancellationToken>())).ReturnsAsync(new TableColumnsResult("Customer", 0, []));
        _commoditySeed.Setup(s => s.SeedAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new CommoditySeedResult(0, 0, 0));
        _elevatorCache.Setup(s => s.RefreshAsync(false, It.IsAny<CancellationToken>())).ReturnsAsync(new ElevatorCacheRefreshResult(0, 0, 0, 0, 0, 0));
        _elevatorCache.Setup(s => s.TryStartBackgroundGeocode()).Returns(new ElevatorGeocodeStarted("Geocoding started in background", 0, 0));
        _elevatorCache.Setup(s => s.GetGeocodeStatusAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new ElevatorGeocodeStatus(0, 0, 0, 0));
        _elevatorCache.Setup(s => s.GeocodeByZipAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new object());
        _ctrm.Setup(s => s.GetConnectivityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new CtrmConnectivityResult());
        _ctrm.Setup(s => s.GetContractsForProducerAsync("TATOBIN", It.IsAny<CancellationToken>())).ReturnsAsync(new CtrmProducerContractsResult());
        _ctrm.Setup(s => s.GetAliasBatchSupportAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new CtrmAliasBatchResult());
        _ctrm.Setup(s => s.GetProducerTimingAsync("TATOBIN", false, It.IsAny<CancellationToken>())).ReturnsAsync(new CtrmProducerTimingResult());
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task InProduction_EveryGatedRoute_Returns404_WithoutTouchingAService(string environment)
    {
        var sut = CreateSut(environment);

        foreach (var invoke in DevOrQaOnlyActions().Concat(NonProductionActions()))
            Assert.IsType<NotFoundResult>(await invoke(sut));

        // Strict mocks: any service call above would have thrown. Say it explicitly as well.
        _schema.VerifyNoOtherCalls();
        _ctrm.VerifyNoOtherCalls();
        _commoditySeed.VerifyNoOtherCalls();
        _elevatorCache.VerifyNoOtherCalls();
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task InDeployedDev_SchemaAndCacheRoutes_Return404_ButCtrmProbesRun()
    {
        SetUpEveryServiceToSucceed();
        var sut = CreateSut("Dev");

        foreach (var invoke in DevOrQaOnlyActions())
            Assert.IsType<NotFoundResult>(await invoke(sut));

        foreach (var invoke in NonProductionActions())
            Assert.IsType<OkObjectResult>(await invoke(sut));

        _schema.VerifyNoOtherCalls();
        _commoditySeed.VerifyNoOtherCalls();
        _elevatorCache.VerifyNoOtherCalls();
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("Development")]
    [InlineData("QA")]
    public async Task InDevelopmentOrQa_EveryGatedRoute_RunsAndDelegates(string environment)
    {
        SetUpEveryServiceToSucceed();
        var sut = CreateSut(environment);

        foreach (var invoke in DevOrQaOnlyActions().Concat(NonProductionActions()))
        {
            var result = await invoke(sut);
            Assert.True(result is OkObjectResult or AcceptedResult, $"{result.GetType().Name} is not a success result");
        }

        _schema.VerifyAll();
        _ctrm.VerifyAll();
        _commoditySeed.VerifyAll();
        _elevatorCache.VerifyAll();
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UngatedRoutes_RunInProduction()
    {
        _usageRollups.Setup(s => s.BackfillAsync(90, It.IsAny<CancellationToken>())).ReturnsAsync(new UsageRollupBackfillResult(90, 13));
        _appAccess.Setup(s => s.GetGroupMembersAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AppAccessGroupMembersResponse { Outcome = "Ok" });
        var sut = CreateSut("Production");

        var backfill = Assert.IsType<OkObjectResult>(await sut.BackfillUsageRollups());
        Assert.Equal(new UsageRollupBackfillResult(90, 13), backfill.Value);

        var members = Assert.IsType<OkObjectResult>(await sut.GetAppAccessGroupMembers());
        Assert.Equal("Ok", Assert.IsType<AppAccessGroupMembersResponse>(members.Value).Outcome);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BackfillPassesTheRequestedDaysThrough_ClampingBelongsToTheService()
    {
        _usageRollups.Setup(s => s.BackfillAsync(500, It.IsAny<CancellationToken>())).ReturnsAsync(new UsageRollupBackfillResult(90, 13));
        var sut = CreateSut("Production");

        await sut.BackfillUsageRollups(days: 500);

        _usageRollups.Verify(s => s.BackfillAsync(500, It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CtrmContracts_MissingScoularId_Returns400_BeforeTheService(string? scoularId)
    {
        var sut = CreateSut("Development");

        var result = Assert.IsType<BadRequestObjectResult>(await sut.GetCtrmContractsForProducer(scoularId!));

        Assert.Contains("scoularId is required", result.Value!.ToString());
        _ctrm.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task CtrmContracts_TrimsTheScoularId_BeforeTheService()
    {
        _ctrm.Setup(s => s.GetContractsForProducerAsync("TATOBIN", It.IsAny<CancellationToken>())).ReturnsAsync(new CtrmProducerContractsResult());
        var sut = CreateSut("Development");

        Assert.IsType<OkObjectResult>(await sut.GetCtrmContractsForProducer("  TATOBIN "));

        _ctrm.VerifyAll();
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null, "scoularId is required")]
    [InlineData("", "scoularId is required")]
    [InlineData("THIS-IS-FAR-TOO-LONG-FOR-A-CODE", "not a plausible customer code")]
    public async Task ProducerTiming_InvalidScoularId_Returns400_BeforeTheService(string? scoularId, string expectedError)
    {
        var sut = CreateSut("Development");

        var result = Assert.IsType<BadRequestObjectResult>(await sut.GetCtrmProducerTiming(scoularId!));

        Assert.Contains(expectedError, result.Value!.ToString());
        _ctrm.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task ProducerTiming_PassesTrimmedCodeAndColdFlag()
    {
        _ctrm.Setup(s => s.GetProducerTimingAsync("TATOBIN", true, It.IsAny<CancellationToken>())).ReturnsAsync(new CtrmProducerTimingResult());
        var sut = CreateSut("QA");

        Assert.IsType<OkObjectResult>(await sut.GetCtrmProducerTiming(" TATOBIN ", cold: true));

        _ctrm.VerifyAll();
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void StartElevatorGeocode_WhenAlreadyRunning_Returns409()
    {
        _elevatorCache.Setup(s => s.TryStartBackgroundGeocode()).Returns((ElevatorGeocodeStarted?)null);
        var sut = CreateSut("Development");

        var result = Assert.IsType<ConflictObjectResult>(sut.StartElevatorGeocode());

        Assert.Contains("Geocoding is already in progress.", result.Value!.ToString());
    }

    [Fact]
    public void StartElevatorGeocode_WhenStarted_Returns202_WithTheEstimate()
    {
        var started = new ElevatorGeocodeStarted("Geocoding started in background", 120, 3);
        _elevatorCache.Setup(s => s.TryStartBackgroundGeocode()).Returns(started);
        var sut = CreateSut("Development");

        var result = Assert.IsType<AcceptedResult>(sut.StartElevatorGeocode());

        Assert.Same(started, result.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ServiceExceptions_FlowOutOfTheController_ForTheGlobalHandler()
    {
        _schema.Setup(s => s.GetTablesAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("boom"));
        var sut = CreateSut("Development");

        await Assert.ThrowsAsync<InvalidOperationException>(() => sut.GetTables());
    }
}
