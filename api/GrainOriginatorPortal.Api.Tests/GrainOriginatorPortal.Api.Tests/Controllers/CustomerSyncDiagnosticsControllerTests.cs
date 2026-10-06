// Microsoft namespaces
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// <c>api/diagnostics/customer-sync/*</c>. <see cref="CustomerSyncService"/> is concrete and resolves its
/// repositories and source factory from a scope, so it is built exactly as <c>CustomerSyncServiceTests</c>
/// builds it: a real service over a <see cref="ServiceCollection"/> holding mocked repositories and a stub
/// source factory. The controller receives that same service and that same factory.
/// </summary>
public class CustomerSyncDiagnosticsControllerTests
{
    private readonly Mock<ICustomerSyncRepository> _repo = new();
    private readonly Mock<ICustomerRepository> _customerRepo = new();
    private readonly Mock<ICtrmGraphQlClient> _ctrmClient = new();
    private readonly List<Customer> _appCustomers = [];
    private readonly List<CustomerTradeUnit> _appTradeUnits = [];
    private readonly Dictionary<string, string?> _settings = new();
    private readonly StubFactory _factory = new();
    private string _environmentName = "Development";
    private CustomerSyncService? _sync;

    public CustomerSyncDiagnosticsControllerTests()
    {
        _repo.Setup(r => r.LoadAppCustomersAsync(It.IsAny<CancellationToken>())).ReturnsAsync(() => _appCustomers);
        _repo.Setup(r => r.LoadAppTradeUnitsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(() => _appTradeUnits);
        _repo.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
    }

    // ── Harness ──────────────────────────────────────────────────────────────────────────────────

    private IConfiguration Configuration() => new ConfigurationBuilder().AddInMemoryCollection(_settings).Build();

    /// <summary>The singleton service, built once per test so a run driven directly is visible to the controller.</summary>
    private CustomerSyncService Sync()
    {
        if (_sync is not null) return _sync;

        var services = new ServiceCollection();
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddScoped(_ => _repo.Object);
        services.AddScoped(_ => _customerRepo.Object);
        services.AddScoped<ICustomerSyncSourceFactory>(_ => _factory);
        var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });

        return _sync = new CustomerSyncService(
            provider.GetRequiredService<IServiceScopeFactory>(), Configuration(), NullLogger<CustomerSyncService>.Instance);
    }

    private CustomerSyncDiagnosticsController CreateSut()
    {
        var env = new Mock<IWebHostEnvironment>();
        env.Setup(e => e.EnvironmentName).Returns(_environmentName);
        var configuration = Configuration();

        return new CustomerSyncDiagnosticsController(
            Sync(),
            _repo.Object,
            _factory,
            new CtrmCustomerReader(_ctrmClient.Object, configuration, NullLogger<CtrmCustomerReader>.Instance),
            env.Object,
            configuration,
            NullLogger<CustomerSyncDiagnosticsController>.Instance);
    }

    private StubSource Source(string name, CustomerSyncSourceResult result)
    {
        var source = new StubSource(name, result);
        _factory.Sources[name] = source;
        return source;
    }

    private static CustomerSyncSourceResult OkRows(string source, params (long Id, string? TradeUnit)[] rows) => new()
    {
        Source = source,
        Rows = [.. rows.Select(r => new CustomerSyncSourceRow { CustomerId = r.Id, TradeUnit = r.TradeUnit, Attributes = new NameAttributes("Farm") })]
    };

    private static CustomerSyncSourceResult NoPermission(string source) => new()
    {
        Source = source,
        Ok = false,
        FailureCode = "CUSTOMER_SYNC_NO_PERMISSION",
        FailureDetail = "CTRM customer lookup failed (Unauthorized, HTTP 403)",
        Lookup = new CustomerSyncLookupInfo { Status = "Unauthorized", Permission = "missing", HttpStatus = 403, Requested = 1 }
    };

    // ── POST run ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Run_SourceOverrideWithoutDryRun_Returns400()
    {
        var source = Source(CustomerSyncSources.Ods, OkRows(CustomerSyncSources.Ods, (1, "1085")));

        var result = await CreateSut().Run(dryRun: false, source: "ctrm");

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Null(source.SeenOptions);
        Assert.Null(Sync().LastRun);
    }

    [Fact]
    public async Task Run_AbortedResult_Returns409_WithTheResultBody()
    {
        Source(CustomerSyncSources.Ods, NoPermission(CustomerSyncSources.Ods));

        var result = await CreateSut().Run();

        var conflict = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status409Conflict, conflict.StatusCode);
        var body = Assert.IsType<CustomerSyncResult>(conflict.Value);
        Assert.True(body.Aborted);
        Assert.Equal("CUSTOMER_SYNC_NO_PERMISSION", body.AbortCode);
    }

    [Fact]
    public async Task Run_DryRun_Returns200_WithDryRunTrue()
    {
        var source = Source(CustomerSyncSources.Ods, OkRows(CustomerSyncSources.Ods, (1, "1085")));

        var result = await CreateSut().Run(dryRun: true);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<CustomerSyncResult>(ok.Value);
        Assert.True(body.DryRun);
        Assert.False(body.Aborted);
        Assert.True(source.SeenOptions!.DryRun);
        _repo.Verify(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Run_DryRunWithSourceAndDiscoveryFrom_ReadsThatSource_WithTheWindowStart()
    {
        _settings[CustomerSyncSources.ConfigKey] = "ods";
        var ctrm = Source(CustomerSyncSources.Ctrm, OkRows(CustomerSyncSources.Ctrm, (1, "1085")));
        var from = new DateTime(2026, 9, 1);

        var result = await CreateSut().Run(dryRun: true, source: "ctrm", discoveryFrom: from);

        var body = Assert.IsType<CustomerSyncResult>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(CustomerSyncSources.Ctrm, body.Source);
        Assert.Equal([CustomerSyncSources.Ctrm], _factory.Requested);
        Assert.Equal(from, ctrm.SeenOptions!.DiscoveryFrom);
    }

    [Fact]
    public async Task Run_Force_BypassesATrippedGuard_AndRecordsAManualRun()
    {
        // One active customer that the source no longer returns: 100 % deactivation trips the default 5 % guard.
        _appCustomers.Add(new Customer { Id = 1, Name = "Old", IsActive = true, ScoularId = "S1" });
        _appCustomers.Add(new Customer { Id = 2, Name = "Old", IsActive = true, ScoularId = "S2" });
        Source(CustomerSyncSources.Ods, OkRows(CustomerSyncSources.Ods, (1, "1085")));

        var forced = await CreateSut().Run(force: true);

        var body = Assert.IsType<CustomerSyncResult>(Assert.IsType<OkObjectResult>(forced).Value);
        Assert.False(body.Aborted);
        Assert.True(body.Guard!.Tripped);
        Assert.Equal("manual", Sync().LastRun!.Trigger);
        Assert.Equal("ok", Sync().LastRun!.Outcome);
    }

    // ── GET last-run ─────────────────────────────────────────────────────────────────────────────

    /// <summary>The anonymous last-run body, read back through its JSON shape (the route returns an anonymous object).</summary>
    private static JsonElement LastRunBody(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        return JsonSerializer.SerializeToElement(ok.Value);
    }

    [Fact]
    public void LastRun_BeforeAnyRun_Returns200_WithNullLastRun_AndTheProcessStart()
    {
        var sut = CreateSut();

        var body = LastRunBody(sut.LastRun());

        Assert.Equal(JsonValueKind.Null, body.GetProperty("LastRun").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("LastSuccessfulRunUtc").ValueKind);
        Assert.Equal(Sync().StartedUtc, body.GetProperty("ProcessStartedUtc").GetDateTime());
        Assert.True(body.GetProperty("Stale").GetBoolean());
        Assert.True(body.GetProperty("NowUtc").GetDateTime() >= Sync().StartedUtc);
    }

    [Fact]
    public async Task LastRun_AfterAnAbortedRun_ReportsTheAbortCode()
    {
        Source(CustomerSyncSources.Ods, NoPermission(CustomerSyncSources.Ods));
        await Sync().SyncAsync(new CustomerSyncOptions { Trigger = "manual" }, CancellationToken.None);

        var body = LastRunBody(CreateSut().LastRun());

        var lastRun = body.GetProperty("LastRun");
        Assert.Equal("aborted", lastRun.GetProperty("Outcome").GetString());
        Assert.Equal("CUSTOMER_SYNC_NO_PERMISSION", lastRun.GetProperty("AbortCode").GetString());
        Assert.Equal("manual", lastRun.GetProperty("Trigger").GetString());
        Assert.True(body.GetProperty("Stale").GetBoolean());
    }

    [Fact]
    public async Task LastRun_AfterASuccessfulRun_IsNotStale()
    {
        Source(CustomerSyncSources.Ods, OkRows(CustomerSyncSources.Ods, (1, "1085")));
        await Sync().SyncAsync(new CustomerSyncOptions { Trigger = "scheduled" }, CancellationToken.None);

        var body = LastRunBody(CreateSut().LastRun());

        Assert.False(body.GetProperty("Stale").GetBoolean());
        Assert.Equal(Sync().LastSuccessfulRunUtc, body.GetProperty("LastSuccessfulRunUtc").GetDateTime());
        Assert.Equal("ok", body.GetProperty("LastRun").GetProperty("Outcome").GetString());
        Assert.Equal("scheduled", body.GetProperty("LastRun").GetProperty("Trigger").GetString());
    }

    [Fact]
    public void LastRun_HasNoEnvironmentGate()
    {
        _environmentName = "Production";

        var result = CreateSut().LastRun();

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public void Controller_IsAdminOnly()
    {
        var authorize = typeof(CustomerSyncDiagnosticsController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true)
            .Cast<AuthorizeAttribute>();

        Assert.Contains(authorize, a => a.Policy == "AdminOnly");
    }

    [Fact]
    public void Controller_RoutesUnderDiagnosticsCustomerSync()
    {
        var route = Assert.Single(typeof(CustomerSyncDiagnosticsController)
            .GetCustomAttributes(typeof(RouteAttribute), inherit: true)
            .Cast<RouteAttribute>());

        Assert.Equal("api/diagnostics/customer-sync", route.Template);
    }

    // ── Doubles ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>Attributes that set only Name — enough for the passes to run.</summary>
    private sealed class NameAttributes : CustomerSyncAttributes
    {
        private readonly string _name;

        public NameAttributes(string name) => _name = name;

        public override void ApplyTo(Customer target) => target.Name = _name;
    }

    private sealed class StubSource : ICustomerSyncSource
    {
        private readonly CustomerSyncSourceResult _result;

        public StubSource(string name, CustomerSyncSourceResult result)
        {
            Name = name;
            _result = result;
        }

        public string Name { get; }
        public CustomerSyncAppState? SeenAppState { get; private set; }
        public CustomerSyncLoadOptions? SeenOptions { get; private set; }

        public Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions options, CancellationToken cancellationToken)
        {
            SeenAppState = appState;
            SeenOptions = options;
            return Task.FromResult(_result);
        }
    }

    /// <summary>Serves the stub registered under the requested name (normalised the way the real factory does).</summary>
    private sealed class StubFactory : ICustomerSyncSourceFactory
    {
        public Dictionary<string, ICustomerSyncSource> Sources { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<string> Requested { get; } = [];

        public ICustomerSyncSource Create(string sourceName)
        {
            var name = string.Equals(sourceName?.Trim(), CustomerSyncSources.Ctrm, StringComparison.OrdinalIgnoreCase)
                ? CustomerSyncSources.Ctrm
                : CustomerSyncSources.Ods;
            Requested.Add(name);
            return Sources[name];
        }
    }
}
