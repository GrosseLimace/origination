// Microsoft namespaces
using System.Reflection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;
using Xunit;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The nightly customer sync. Two groups of tests share one harness:
/// <list type="bullet">
/// <item>"Ods_" tests are characterization tests: they run the service over the REAL
/// <see cref="OdsCustomerSyncSource"/> on a mocked <see cref="ICustomerSyncRepository"/> and pin what the
/// sync has always done with <c>vw_CustomerTradeUnits</c> and <c>base.vw_CurrentCustomers</c>, so the
/// move onto <see cref="ICustomerSyncSource"/> provably changes nothing on the ODS path.</item>
/// <item>The others drive the service through a stub source returning a preset
/// <see cref="CustomerSyncSourceResult"/>.</item>
/// </list>
/// </summary>
public class CustomerSyncServiceTests
{
    private readonly Mock<ICustomerSyncRepository> _repo = new();
    private readonly Mock<ICustomerRepository> _customerRepo = new();
    private readonly List<Customer> _appCustomers = [];
    private readonly List<CustomerTradeUnit> _appTradeUnits = [];
    private readonly List<Customer> _added = [];
    private readonly List<CustomerTradeUnit> _addedTradeUnits = [];
    private readonly List<CustomerTradeUnitView> _viewRows = [];
    private readonly List<CurrentCustomerRow> _masterRows = [];
    private readonly List<List<long>> _masterQueries = [];
    private readonly Dictionary<string, HashSet<string>> _openActivity = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string?> _settings = new();
    private readonly List<string> _calls = [];
    private int _saves;
    private readonly ListLogger<CustomerSyncService> _serviceLogger = new();

    // null → the real ODS feeder over _repo (characterization); set → a stub feeder.
    private StubSource? _stub;
    private StubFactory? _stubFactory;

    public CustomerSyncServiceTests()
    {
        // Most tests exercise the passes on a handful of rows, where any deactivation is a large
        // percentage. The guard's limits are therefore lifted here; the guard tests set their own,
        // and SyncAsync_DefaultLimits_TripAboveFivePercent removes these to check the real defaults.
        // (An empty source on a populated app still trips: that rule has no limit.)
        _settings[CustomerSyncGuardLimits.PercentKey] = "100";
        _settings[CustomerSyncGuardLimits.CountKey] = int.MaxValue.ToString(System.Globalization.CultureInfo.InvariantCulture);

        _repo.Setup(r => r.LoadAppCustomersAsync(It.IsAny<CancellationToken>()))
            .Callback(() => _calls.Add("LoadAppCustomers"))
            .ReturnsAsync(() => _appCustomers);
        _repo.Setup(r => r.LoadAppTradeUnitsAsync(It.IsAny<CancellationToken>()))
            .Callback(() => _calls.Add("LoadAppTradeUnits"))
            .ReturnsAsync(() => _appTradeUnits);
        _repo.Setup(r => r.LoadOdsTradeUnitRowsAsync(It.IsAny<CancellationToken>()))
            .Callback(() => _calls.Add("LoadOdsTradeUnitRows"))
            .ReturnsAsync(() => _viewRows.ToList());
        _repo.Setup(r => r.LoadCurrentCustomerMasterAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyCollection<long> ids, CancellationToken _) =>
            {
                _masterQueries.Add(ids.ToList());
                return _masterRows.Where(r => ids.Contains(r.CustomerId)).ToList();
            });
        _repo.Setup(r => r.AddCustomer(It.IsAny<Customer>())).Callback((Customer c) => _added.Add(c));
        _repo.Setup(r => r.AddTradeUnit(It.IsAny<CustomerTradeUnit>())).Callback((CustomerTradeUnit t) => _addedTradeUnits.Add(t));
        _repo.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .Callback(() => _saves++)
            .Returns(Task.CompletedTask);

        _customerRepo.Setup(r => r.GetOpenActivityTradeUnitsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string scoularId, CancellationToken _) =>
                _openActivity.TryGetValue(scoularId, out var set) ? set : new HashSet<string>(StringComparer.OrdinalIgnoreCase));
    }

    // ── Harness ──────────────────────────────────────────────────────────────────────────────────

    private CustomerSyncService CreateService()
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddScoped(_ => _repo.Object);
        services.AddScoped(_ => _customerRepo.Object);
        if (_stub is null)
        {
            services.AddScoped<OdsCustomerSyncSource>();
            services.AddScoped<ICustomerSyncSourceFactory, CustomerSyncSourceFactory>();
        }
        else
        {
            _stubFactory = new StubFactory(_stub);
            services.AddScoped<ICustomerSyncSourceFactory>(_ => _stubFactory);
        }

        var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(_settings).Build();
        return new CustomerSyncService(provider.GetRequiredService<IServiceScopeFactory>(), configuration, _serviceLogger);
    }

    private Task<CustomerSyncResult> RunAsync() => CreateService().SyncAsync(CancellationToken.None);

    private Task<CustomerSyncResult> RunAsync(CustomerSyncOptions options) => CreateService().SyncAsync(options, CancellationToken.None);

    private StubSource UseStub(CustomerSyncSourceResult result, string name = CustomerSyncSources.Ods) =>
        _stub = new StubSource(name, result, _calls);

    private static CustomerSyncSourceRow Row(long customerId, string? tradeUnit, string name) =>
        new() { CustomerId = customerId, TradeUnit = tradeUnit, Attributes = new NameAttributes(name) };

    private Customer AppCustomer(long id, bool isActive = true, bool isManual = false, string name = "Old", string? scoularId = null)
    {
        var c = new Customer { Id = id, Name = name, IsActive = isActive, IsManual = isManual, ScoularId = scoularId ?? $"S{id}" };
        _appCustomers.Add(c);
        return c;
    }

    private CustomerTradeUnit AppLink(long customerId, string tradeUnit, bool isActive = true, bool isManual = false, bool userDeactivated = false)
    {
        var t = new CustomerTradeUnit { CustomerId = customerId, TradeUnit = tradeUnit, IsActive = isActive, IsManual = isManual, UserDeactivated = userDeactivated };
        _appTradeUnits.Add(t);
        return t;
    }

    private void View(long customerId, string? tradeUnit, string name = "Farm") =>
        _viewRows.Add(new CustomerTradeUnitView { CustomerId = customerId, TradeUnit = tradeUnit, CustomerName = name, ScoularId = $"S{customerId}" });

    private void Master(long customerId, string name) =>
        _masterRows.Add(new CurrentCustomerRow { CustomerId = customerId, CustomerName = name, ScoularId = $"S{customerId}" });

    private static bool IsSimple(PropertyInfo p)
    {
        var t = Nullable.GetUnderlyingType(p.PropertyType) ?? p.PropertyType;
        return p.CanRead && p.CanWrite && (t == typeof(string) || t == typeof(DateTime) || t == typeof(bool) || t == typeof(long) || t == typeof(int));
    }

    // ── Characterization: today's ODS behaviour, through the real ODS feeder ─────────────────────

    [Fact]
    public async Task SyncAsync_Ods_InsertsUpdatesReactivatesAndDeactivatesCustomers()
    {
        var updated = AppCustomer(1);
        var dropped = AppCustomer(2);
        var returning = AppCustomer(3, isActive: false);
        var goneLongAgo = AppCustomer(4, isActive: false);
        var graduating = AppCustomer(6, isManual: true);
        View(1, "1085", "One");
        View(3, "1085", "Three");
        View(6, "1085", "Six");
        View(10, "1085", "Ten");

        var result = await RunAsync();

        Assert.Equal(1, result.CustomersInserted);
        Assert.Equal(2, result.CustomersUpdated);
        Assert.Equal(1, result.CustomersReactivated);
        Assert.Equal(1, result.CustomersDeactivated);
        Assert.Equal("One", updated.Name);
        Assert.True(updated.IsActive);
        Assert.False(dropped.IsActive);
        Assert.True(returning.IsActive);
        Assert.Equal("Three", returning.Name);
        Assert.False(goneLongAgo.IsActive);
        Assert.False(graduating.IsManual);
        Assert.True(graduating.IsActive);
        Assert.Equal(10, Assert.Single(_added).Id);
        Assert.Equal(1, _saves);
        Assert.Empty(_masterQueries);
        Assert.True(result.CompletedAtUtc > DateTime.MinValue);
    }

    [Fact]
    public async Task SyncAsync_Ods_InsertedCustomer_CarriesEveryViewAttribute_ActiveAndNotManual()
    {
        var view = new CustomerTradeUnitView
        {
            CustomerId = 42, CustomerName = "Smith Farms", ScoularId = "SMITFAR", MerchandisingPhone = "555",
            MerchandisingEmail = "a@b.c", ExtendedPrimaryPhone = "556", SupplementalEmail = "d@e.f",
            MerchandisingCity = "Omaha", MerchandisingStateProvince = "NE", MerchandisingAddressLine1 = "1 Main",
            MerchandisingPostalCode = "68102", ExtendedAddressLine1 = "x1", ExtendedAddressLine2 = "x2",
            ExtendedAddressLine3 = "x3", ExtendedAddressLine4 = "x4", ExtendedCity = "Lincoln",
            ExtendedStateProvince = "NE", ExtendedPostalCode = "68508", ExtendedCountry = "US",
            IndustryCode1 = "PR", IndustryCode2 = "OR", NopIdNumber = "0",
            EffectiveStartDate = new DateTime(2020, 1, 2), EffectiveEndDate = new DateTime(2030, 3, 4), TradeUnit = "1085",
        };
        _viewRows.Add(view);

        await RunAsync();

        var inserted = Assert.Single(_added);
        var expected = view.ToCustomer();
        expected.IsActive = true;
        foreach (var property in typeof(Customer).GetProperties().Where(IsSimple))
        {
            Assert.True(Equals(property.GetValue(expected), property.GetValue(inserted)), $"{property.Name} differs from ToCustomer() + IsActive");
        }
        Assert.Equal(42, inserted.Id);
        Assert.True(inserted.IsActive);
        Assert.False(inserted.IsManual);
        Assert.Null(inserted.NopIdNumber);
    }

    [Fact]
    public async Task SyncAsync_Ods_FirstViewRowPerCustomer_SuppliesTheAttributes()
    {
        var existing = AppCustomer(1);
        View(1, "1085", "First");
        View(1, "2200", "Second");
        View(7, "1085", "Seven-A");
        View(7, "2200", "Seven-B");

        var result = await RunAsync();

        Assert.Equal("First", existing.Name);
        Assert.Equal("Seven-A", Assert.Single(_added).Name);
        Assert.Equal(1, result.CustomersUpdated);
        Assert.Equal(1, result.CustomersInserted);
    }

    [Fact]
    public async Task SyncAsync_Ods_TradeUnits_InsertRefreshDeactivate_RespectingManualAndUserDeactivated()
    {
        AppCustomer(1);
        var reactivated = AppLink(1, "1085", isActive: false, isManual: true);
        var unchanged = AppLink(1, "2200");
        var dropped = AppLink(1, "3300");
        var manual = AppLink(1, "4400", isManual: true);
        var userRemoved = AppLink(1, "5500", isActive: false, userDeactivated: true);
        var alreadyInactive = AppLink(1, "6600", isActive: false);
        View(1, "1085");
        View(1, "2200");
        View(1, "5500");
        View(1, "7700");
        View(1, "7700"); // duplicate view row → one link

        var result = await RunAsync();

        Assert.Equal(1, result.TradeUnitsInserted);
        Assert.Equal(1, result.TradeUnitsUpdated);
        Assert.Equal(1, result.TradeUnitsDeactivated);
        Assert.Equal(0, result.TradeUnitsBroughtBack);

        Assert.True(reactivated.IsActive);
        Assert.False(reactivated.IsManual);
        Assert.Equal("system", reactivated.ModifiedBy);
        Assert.NotNull(reactivated.ModifiedAt);

        Assert.True(unchanged.IsActive);
        Assert.Null(unchanged.ModifiedAt);
        Assert.Null(unchanged.ModifiedBy);

        Assert.False(dropped.IsActive);
        Assert.Equal("system", dropped.ModifiedBy);

        Assert.True(manual.IsActive);
        Assert.True(manual.IsManual);
        Assert.Null(manual.ModifiedBy);

        Assert.False(userRemoved.IsActive);
        Assert.True(userRemoved.UserDeactivated);
        Assert.Null(userRemoved.ModifiedBy);

        Assert.False(alreadyInactive.IsActive);
        Assert.Null(alreadyInactive.ModifiedBy);

        var inserted = Assert.Single(_addedTradeUnits);
        Assert.Equal(1, inserted.CustomerId);
        Assert.Equal("7700", inserted.TradeUnit);
        Assert.True(inserted.IsActive);
        Assert.False(inserted.IsManual);
        Assert.Equal("system", inserted.CreatedBy);
        Assert.Equal(reactivated.ModifiedAt, inserted.CreatedAt);   // one timestamp per run
        Assert.Equal(reactivated.ModifiedAt, dropped.ModifiedAt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task SyncAsync_Ods_NullOrEmptyTradeUnit_IsCustomerPresenceOnly(string? tradeUnit)
    {
        var existing = AppCustomer(1, isActive: false);
        var link = AppLink(1, "1085");
        View(1, tradeUnit, "Present");
        View(2, tradeUnit, "New");

        var result = await RunAsync();

        Assert.True(existing.IsActive);
        Assert.Equal("Present", existing.Name);
        Assert.Equal(1, result.CustomersReactivated);
        Assert.Equal(2, Assert.Single(_added).Id);
        Assert.Empty(_addedTradeUnits);
        Assert.False(link.IsActive);
        Assert.Equal(1, result.TradeUnitsDeactivated);
    }

    [Fact]
    public async Task SyncAsync_Ods_TradeUnitKey_IsTheRawViewValue_NeverTrimmed()
    {
        AppCustomer(1);
        var trimmed = AppLink(1, "2200");
        View(1, " 2200 ");
        View(1, " ");

        var result = await RunAsync();

        Assert.False(trimmed.IsActive);
        Assert.Equal(1, result.TradeUnitsDeactivated);
        Assert.Equal([" 2200 ", " "], _addedTradeUnits.Select(t => t.TradeUnit));
        Assert.Equal(2, result.TradeUnitsInserted);
    }

    [Fact]
    public async Task SyncAsync_Ods_ManualCustomers_AreRefreshedReactivatedOrDeactivatedFromTheMaster()
    {
        AppCustomer(1);
        var inView = AppCustomer(6, isManual: true);
        var refreshed = AppCustomer(900, isManual: true);
        var reactivated = AppCustomer(901, isActive: false, isManual: true);
        var gone = AppCustomer(902, isManual: true);
        var goneAndInactive = AppCustomer(903, isActive: false, isManual: true);
        View(1, "1085");
        View(6, "1085", "Six");
        Master(900, "Nine Hundred");
        Master(901, "Nine Oh One");
        Master(6, "Six From Master");

        var result = await RunAsync();

        Assert.Equal([900L, 901L, 902L, 903L], Assert.Single(_masterQueries));
        Assert.Equal(1, result.ManualCustomersRefreshed);
        Assert.Equal(1, result.ManualCustomersReactivated);
        Assert.Equal(1, result.ManualCustomersDeactivated);
        Assert.Equal(0, result.CustomersDeactivated);
        Assert.Equal("Nine Hundred", refreshed.Name);
        Assert.True(refreshed.IsActive);
        Assert.True(refreshed.IsManual);
        Assert.Equal("Nine Oh One", reactivated.Name);
        Assert.True(reactivated.IsActive);
        Assert.False(gone.IsActive);
        Assert.Equal("Old", gone.Name);
        Assert.False(goneAndInactive.IsActive);
        Assert.Equal("Six", inView.Name);
        Assert.False(inView.IsManual);
    }

    [Fact]
    public async Task SyncAsync_Ods_NoManualCustomersOutsideTheView_DoesNotQueryTheMaster()
    {
        AppCustomer(1, isManual: true);
        AppCustomer(2);
        View(1, "1085");

        await RunAsync();

        Assert.Empty(_masterQueries);
        _repo.Verify(r => r.LoadCurrentCustomerMasterAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SyncAsync_Ods_DuplicateMasterIds_Throw_AndNeverSave()
    {
        AppCustomer(900, isManual: true);
        View(1, "1085");
        Master(900, "One");
        Master(900, "Two");

        await Assert.ThrowsAsync<ArgumentException>(RunAsync);

        Assert.Equal(0, _saves);
    }

    [Fact]
    public async Task SyncAsync_Ods_ViewReadFailure_Propagates_AndNeverSaves()
    {
        AppCustomer(1);
        _repo.Setup(r => r.LoadOdsTradeUnitRowsAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("ODS down"));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(RunAsync);

        Assert.Equal("ODS down", ex.Message);
        Assert.Equal(0, _saves);
    }

    [Fact]
    public async Task SyncAsync_Ods_UserDeactivatedLinks_AreBroughtBackOnlyWithOpenActivity()
    {
        AppCustomer(1);   // ScoularId "S1" (the view row re-applies the same code before the bring-back pass)
        AppCustomer(2).ScoularId = null;   // no ScoularId → skipped by the bring-back pass
        var regained = AppLink(1, " 5500 ", isActive: false, userDeactivated: true);
        var stillDormant = AppLink(1, "6600", isActive: false, userDeactivated: true);
        var noCode = AppLink(2, "5500", isActive: false, userDeactivated: true);
        _openActivity["S1"] = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "5500" };
        View(1, " 5500 ");
        View(1, "6600");

        var result = await RunAsync();

        Assert.Equal(1, result.TradeUnitsBroughtBack);
        Assert.False(regained.UserDeactivated);
        Assert.True(regained.IsActive);
        Assert.False(regained.IsManual);
        Assert.Equal("system", regained.ModifiedBy);
        Assert.True(stillDormant.UserDeactivated);
        Assert.False(stillDormant.IsActive);
        Assert.True(noCode.UserDeactivated);
        _customerRepo.Verify(r => r.GetOpenActivityTradeUnitsAsync("S1", It.IsAny<CancellationToken>()), Times.Once);
        _customerRepo.Verify(r => r.GetOpenActivityTradeUnitsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Through a stub feeder ────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SyncAsync_NewRowInserts_ExistingRowUpdates_MissingRowDeactivates()
    {
        var one = AppCustomer(1);
        var two = AppCustomer(2);
        UseStub(new CustomerSyncSourceResult { Source = CustomerSyncSources.Ods, Rows = [Row(1, "1085", "New"), Row(3, "2200", "Third")] });

        var result = await RunAsync();

        var inserted = Assert.Single(_added);
        Assert.Equal(3, inserted.Id);
        Assert.True(inserted.IsActive);
        Assert.False(inserted.IsManual);
        Assert.Equal("Third", inserted.Name);
        Assert.Equal("New", one.Name);
        Assert.Equal(1, result.CustomersUpdated);
        Assert.False(two.IsActive);
        Assert.Equal(1, result.CustomersDeactivated);
        Assert.Equal(1, result.CustomersInserted);
        Assert.Equal(1, _saves);
    }

    [Fact]
    public async Task SyncAsync_ManualCustomerAbsentFromRows_IsRefreshedFromManualMaster_OrDeactivatedWhenMissing()
    {
        AppCustomer(1);
        var refreshed = AppCustomer(900, isManual: true);
        var reactivated = AppCustomer(901, isActive: false, isManual: true);
        var gone = AppCustomer(902, isManual: true);
        UseStub(new CustomerSyncSourceResult
        {
            Source = CustomerSyncSources.Ods,
            Rows = [Row(1, "1085", "One")],
            ManualMaster = new() { [900] = new NameAttributes("Refreshed"), [901] = new NameAttributes("Back") },
        });

        var result = await RunAsync();

        Assert.Equal("Refreshed", refreshed.Name);
        Assert.True(refreshed.IsActive);
        Assert.Equal("Back", reactivated.Name);
        Assert.True(reactivated.IsActive);
        Assert.False(gone.IsActive);
        Assert.Equal(1, result.ManualCustomersRefreshed);
        Assert.Equal(1, result.ManualCustomersReactivated);
        Assert.Equal(1, result.ManualCustomersDeactivated);
        Assert.Equal(0, result.CustomersDeactivated);
        _repo.Verify(r => r.LoadCurrentCustomerMasterAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SyncAsync_ManualMasterIncomplete_NeverDeactivatesManualCustomers()
    {
        AppCustomer(1);
        var refreshed = AppCustomer(900, isManual: true);
        var unknown = AppCustomer(902, isManual: true);
        UseStub(new CustomerSyncSourceResult
        {
            Source = CustomerSyncSources.Ctrm,
            Rows = [Row(1, "1085", "One")],
            ManualMaster = new() { [900] = new NameAttributes("Refreshed") },
            ManualMasterComplete = false,
        });

        var result = await RunAsync();

        Assert.True(unknown.IsActive);
        Assert.Equal("Old", unknown.Name);
        Assert.Equal("Refreshed", refreshed.Name);
        Assert.Equal(1, result.ManualCustomersRefreshed);
        Assert.Equal(0, result.ManualCustomersDeactivated);
    }

    [Fact]
    public async Task SyncAsync_ManualUnverifiable_IsNeitherRefreshedNorDeactivated()
    {
        AppCustomer(1);
        var unverifiable = AppCustomer(905, isManual: true);
        var unverifiableInactive = AppCustomer(906, isActive: false, isManual: true);
        UseStub(new CustomerSyncSourceResult
        {
            Source = CustomerSyncSources.Ctrm,
            Rows = [Row(1, "1085", "One")],
            ManualMaster = new() { [906] = new NameAttributes("Should Not Apply") },
            ManualUnverifiable = [905, 906],
        });

        var result = await RunAsync();

        Assert.True(unverifiable.IsActive);
        Assert.Equal("Old", unverifiable.Name);
        Assert.False(unverifiableInactive.IsActive);
        Assert.Equal("Old", unverifiableInactive.Name);
        Assert.Equal(0, result.ManualCustomersRefreshed + result.ManualCustomersReactivated + result.ManualCustomersDeactivated);
    }

    [Fact]
    public async Task SyncAsync_SourceNotOk_AbortsWithTheSourceCode_AndNeverSaves()
    {
        var existing = AppCustomer(1);
        var link = AppLink(1, "1085");
        AppCustomer(900, isManual: true);
        UseStub(CustomerSyncSourceResult.Failed(CustomerSyncSources.Ctrm, "CUSTOMER_SYNC_NO_PERMISSION", "Customers.Read.All missing"), CustomerSyncSources.Ctrm);

        var result = await RunAsync();

        Assert.True(result.Aborted);
        Assert.Equal("CUSTOMER_SYNC_NO_PERMISSION", result.AbortCode);
        Assert.Equal("Customers.Read.All missing", result.AbortReason);
        Assert.Equal(0, _saves);
        Assert.True(existing.IsActive);
        Assert.True(link.IsActive);
        Assert.Equal(0, result.CustomersDeactivated + result.TradeUnitsDeactivated + result.ManualCustomersDeactivated);
        _repo.Verify(r => r.AddCustomer(It.IsAny<Customer>()), Times.Never);
        _repo.Verify(r => r.AddTradeUnit(It.IsAny<CustomerTradeUnit>()), Times.Never);
        _repo.Verify(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(null, CustomerSyncSources.Ods)]
    [InlineData("", CustomerSyncSources.Ods)]
    [InlineData("graphql", CustomerSyncSources.Ods)]
    [InlineData(" CTRM ", CustomerSyncSources.Ctrm)]
    public async Task SyncAsync_ReportsTheSourceName(string? setting, string expected)
    {
        _settings[CustomerSyncSources.ConfigKey] = setting;
        UseStub(new CustomerSyncSourceResult { Source = expected, Rows = [Row(1, "1085", "One")] }, expected);

        var result = await RunAsync();

        Assert.Equal([expected], _stubFactory!.Requested);
        Assert.Equal(expected, result.Source);
        Assert.False(result.Aborted);
    }

    [Fact]
    public async Task SyncAsync_LoadsTheTrackedAppStateFirst_AndHandsTheSameListsToTheSource()
    {
        AppCustomer(1);
        AppLink(1, "1085");
        var stub = UseStub(new CustomerSyncSourceResult { Source = CustomerSyncSources.Ods, Rows = [Row(1, "1085", "One")] });

        await RunAsync();

        Assert.Equal(["LoadAppCustomers", "LoadAppTradeUnits", "Source.LoadAsync"], _calls);
        Assert.Same(_appCustomers, stub.SeenAppState!.Customers);
        Assert.Same(_appTradeUnits, stub.SeenAppState.TradeUnits);
        Assert.False(stub.SeenOptions!.DryRun);
    }

    // ── Guard, force, dry run, source override ───────────────────────────────────────────────────

    private void HundredActiveCustomers_SourceCovers(int covered)
    {
        for (var id = 1; id <= 100; id++) AppCustomer(id);
        UseStub(new CustomerSyncSourceResult
        {
            Source = CustomerSyncSources.Ods,
            Rows = Enumerable.Range(1, covered).Select(id => Row(id, "1085", $"C{id}")).ToList(),
        });
    }

    [Fact]
    public async Task SyncAsync_GuardTrips_AbortsWithoutSaving_AndReportsTheVerdict()
    {
        _settings["CustomerSync:MaxDeactivationCount"] = "10";
        HundredActiveCustomers_SourceCovers(10);

        var result = await RunAsync();

        Assert.True(result.Aborted);
        Assert.Equal("CUSTOMER_SYNC_GUARD_TRIPPED", result.AbortCode);
        Assert.NotNull(result.Guard);
        Assert.True(result.Guard!.Tripped);
        Assert.Equal(10, result.Guard.SourceRows);
        Assert.Equal(100, result.Guard.ActiveCustomersBefore);
        Assert.Equal(90, result.Guard.CustomersToDeactivate);
        Assert.Equal(result.Guard.Reason, result.AbortReason);
        Assert.Equal(0, _saves);
        _repo.Verify(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(95, false)]   // 5 of 100 = 5 % → allowed
    [InlineData(94, true)]    // 6 of 100 = 6 % → tripped
    public async Task SyncAsync_DefaultLimits_TripAboveFivePercent(int covered, bool tripped)
    {
        _settings.Remove(CustomerSyncGuardLimits.PercentKey);
        _settings.Remove(CustomerSyncGuardLimits.CountKey);
        HundredActiveCustomers_SourceCovers(covered);

        var result = await RunAsync();

        Assert.Equal(tripped, result.Aborted);
        Assert.Equal(tripped, result.Guard!.Tripped);
        Assert.Equal(tripped ? 0 : 1, _saves);
    }

    [Fact]
    public async Task SyncAsync_GuardTrips_LogsTheCodeAtError()
    {
        _settings["CustomerSync:MaxDeactivationCount"] = "10";
        HundredActiveCustomers_SourceCovers(10);

        await RunAsync();

        Assert.Contains(_serviceLogger.Entries, e => e.Level == LogLevel.Error && e.Message.Contains("CUSTOMER_SYNC_GUARD_TRIPPED"));
    }

    [Fact]
    public async Task SyncAsync_GuardCountsLinksToDeactivate()
    {
        _settings["CustomerSync:MaxDeactivationCount"] = "10";
        _settings["CustomerSync:MaxDeactivationPercent"] = "100";
        AppCustomer(1);
        for (var tu = 0; tu < 11; tu++) AppLink(1, $"TU{tu}");
        UseStub(new CustomerSyncSourceResult { Source = CustomerSyncSources.Ods, Rows = [Row(1, null, "One")] });

        var result = await RunAsync();

        Assert.True(result.Aborted);
        Assert.Equal("CUSTOMER_SYNC_GUARD_TRIPPED", result.AbortCode);
        Assert.Equal(11, result.Guard!.ActiveLinksBefore);
        Assert.Equal(11, result.Guard.LinksToDeactivate);
        Assert.Equal(0, _saves);
    }

    [Fact]
    public async Task SyncAsync_GuardCountsManualDeactivations()
    {
        _settings["CustomerSync:MaxDeactivationCount"] = "1";
        _settings["CustomerSync:MaxDeactivationPercent"] = "100";
        AppCustomer(1);
        AppCustomer(900, isManual: true);
        AppCustomer(901, isManual: true);
        UseStub(new CustomerSyncSourceResult { Source = CustomerSyncSources.Ods, Rows = [Row(1, "1085", "One")] });

        var result = await RunAsync();

        Assert.True(result.Aborted);
        Assert.Equal(2, result.Guard!.CustomersToDeactivate);
        Assert.Equal(0, _saves);
    }

    [Fact]
    public async Task SyncAsync_EmptyRowsOnPopulatedApp_AbortsAsSourceEmpty()
    {
        AppCustomer(1);
        AppLink(1, "1085");
        UseStub(new CustomerSyncSourceResult { Source = CustomerSyncSources.Ods, Rows = [] });

        var result = await RunAsync();

        Assert.True(result.Aborted);
        Assert.Equal("CUSTOMER_SYNC_SOURCE_EMPTY", result.AbortCode);
        Assert.True(result.Guard!.Tripped);
        Assert.Equal(0, result.Guard.SourceRows);
        Assert.Equal(0, _saves);
        Assert.Contains(_serviceLogger.Entries, e => e.Level == LogLevel.Error && e.Message.Contains("CUSTOMER_SYNC_SOURCE_EMPTY"));
    }

    [Fact]
    public async Task SyncAsync_EmptyRowsOnEmptyApp_IsNotAnAbort()
    {
        UseStub(new CustomerSyncSourceResult { Source = CustomerSyncSources.Ods, Rows = [] });

        var result = await RunAsync();

        Assert.False(result.Aborted);
        Assert.False(result.Guard!.Tripped);
        Assert.Equal(1, _saves);
    }

    [Fact]
    public async Task SyncAsync_Force_BypassesTheGuard_AndSaves()
    {
        _settings["CustomerSync:MaxDeactivationCount"] = "10";
        HundredActiveCustomers_SourceCovers(10);

        var result = await RunAsync(new CustomerSyncOptions { Force = true });

        Assert.False(result.Aborted);
        Assert.Null(result.AbortCode);
        Assert.True(result.Guard!.Tripped);
        Assert.Equal(90, result.CustomersDeactivated);
        Assert.Equal(1, _saves);
        Assert.Contains(_serviceLogger.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("force"));
    }

    [Fact]
    public async Task SyncAsync_Force_DoesNotBypassAFailedSource()
    {
        AppCustomer(1);
        UseStub(CustomerSyncSourceResult.Failed(CustomerSyncSources.Ctrm, "CUSTOMER_SYNC_SOURCE_UNAVAILABLE", "gateway down"), CustomerSyncSources.Ctrm);

        var result = await RunAsync(new CustomerSyncOptions { Force = true });

        Assert.True(result.Aborted);
        Assert.Equal("CUSTOMER_SYNC_SOURCE_UNAVAILABLE", result.AbortCode);
        Assert.Null(result.Guard);
        Assert.Equal(0, _saves);
    }

    [Fact]
    public async Task SyncAsync_DryRun_ComputesCounters_ButNeverSaves()
    {
        HundredActiveCustomers_SourceCovers(99);
        _stub!.Result.Rows.Add(Row(500, "2200", "New"));

        var result = await RunAsync(new CustomerSyncOptions { DryRun = true });

        Assert.True(result.DryRun);
        Assert.False(result.Aborted);
        Assert.True(result.CustomersDeactivated > 0);
        Assert.Equal(1, result.CustomersInserted);
        Assert.Equal(100, result.TradeUnitsInserted);   // 99 covered customers + the new one, none linked yet
        Assert.False(result.Guard!.Tripped);
        Assert.Equal(0, _saves);
        _repo.Verify(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SyncAsync_DryRun_ThatWouldTripTheGuard_ReportsTheAbort_AndNeverSaves()
    {
        _settings["CustomerSync:MaxDeactivationCount"] = "10";
        HundredActiveCustomers_SourceCovers(10);

        var result = await RunAsync(new CustomerSyncOptions { DryRun = true });

        Assert.True(result.DryRun);
        Assert.True(result.Aborted);
        Assert.Equal("CUSTOMER_SYNC_GUARD_TRIPPED", result.AbortCode);
        Assert.Equal(0, _saves);
    }

    [Fact]
    public async Task SyncAsync_NonDryRun_ReportsDryRunFalse_AndSaves()
    {
        HundredActiveCustomers_SourceCovers(100);

        var result = await RunAsync(new CustomerSyncOptions());

        Assert.False(result.DryRun);
        Assert.False(result.Aborted);
        Assert.Equal(1, _saves);
    }

    [Fact]
    public async Task SyncAsync_SourceOverride_IsHonouredOnlyWithDryRun()
    {
        HundredActiveCustomers_SourceCovers(100);

        await RunAsync(new CustomerSyncOptions { SourceOverride = "ctrm", DryRun = false });
        Assert.Equal([CustomerSyncSources.Ods], _stubFactory!.Requested);

        await RunAsync(new CustomerSyncOptions { SourceOverride = "ctrm", DryRun = true });
        Assert.Equal([CustomerSyncSources.Ctrm], _stubFactory!.Requested);

        // The override wins over the environment setting in both directions, still only on a dry run.
        _settings[CustomerSyncSources.ConfigKey] = "ctrm";
        await RunAsync(new CustomerSyncOptions { SourceOverride = "ods", DryRun = true });
        Assert.Equal([CustomerSyncSources.Ods], _stubFactory!.Requested);
    }

    [Fact]
    public async Task SyncAsync_PassesDryRunAndDiscoveryFromToTheSource()
    {
        var stub = UseStub(new CustomerSyncSourceResult { Source = CustomerSyncSources.Ods, Rows = [] });
        var from = new DateTime(2026, 1, 1);

        await RunAsync(new CustomerSyncOptions { DryRun = true, DiscoveryFrom = from });

        Assert.True(stub.SeenOptions!.DryRun);
        Assert.Equal(from, stub.SeenOptions.DiscoveryFrom);
    }

    [Fact]
    public async Task SyncAsync_CopiesTheSourceReportOntoTheResult_EvenWhenTheSourceFails()
    {
        var lookup = new CustomerSyncLookupInfo { Permission = "missing", Requested = 3 };
        var discovery = new CustomerSyncDiscoveryInfo { NewCodes = 2 };
        AppCustomer(1);
        UseStub(new CustomerSyncSourceResult
        {
            Source = CustomerSyncSources.Ctrm, Rows = [Row(1, "1085", "One")], CustomersMinted = 2, Lookup = lookup, Discovery = discovery,
        }, CustomerSyncSources.Ctrm);

        var ok = await RunAsync();

        Assert.Equal(2, ok.CustomersMinted);
        Assert.Same(lookup, ok.Lookup);
        Assert.Same(discovery, ok.Discovery);

        UseStub(new CustomerSyncSourceResult
        {
            Source = CustomerSyncSources.Ctrm, Ok = false, FailureCode = "CUSTOMER_SYNC_NO_PERMISSION", FailureDetail = "x", Lookup = lookup,
        }, CustomerSyncSources.Ctrm);

        var failed = await RunAsync();

        Assert.True(failed.Aborted);
        Assert.Same(lookup, failed.Lookup);
    }

    // ── Last-run record (D14): the singleton remembers its last non-dry run ──────────────────────

    [Fact]
    public async Task SyncAsync_CompletedRun_RecordsLastRunOk_WithTriggerSourceAndCounters()
    {
        HundredActiveCustomers_SourceCovers(100);
        var service = CreateService();

        var result = await service.SyncAsync(new CustomerSyncOptions { Trigger = "scheduled" }, CancellationToken.None);

        var lastRun = Assert.IsType<CustomerSyncLastRun>(service.LastRun);
        Assert.Equal("ok", lastRun.Outcome);
        Assert.Equal("scheduled", lastRun.Trigger);
        Assert.Equal(CustomerSyncSources.Ods, lastRun.Source);
        Assert.Same(result, lastRun.Result);
        Assert.Equal(100, lastRun.Result!.CustomersUpdated);
        Assert.Null(lastRun.AbortCode);
        Assert.Null(lastRun.ExceptionType);
        Assert.True(lastRun.FinishedUtc >= lastRun.StartedUtc);
        Assert.True(lastRun.StartedUtc >= service.StartedUtc);
        Assert.Equal(lastRun.FinishedUtc, service.LastSuccessfulRunUtc);
        Assert.Contains(_serviceLogger.Entries, e => e.Level == LogLevel.Information && e.Message.Contains("last run recorded") && e.Message.Contains("ok"));
    }

    [Fact]
    public async Task SyncAsync_AbortedRun_RecordsLastRunAborted_WithTheCode_AndLeavesLastSuccessfulUntouched()
    {
        _settings["CustomerSync:MaxDeactivationCount"] = "10";
        HundredActiveCustomers_SourceCovers(100);
        var service = CreateService();
        await service.SyncAsync(new CustomerSyncOptions { Trigger = "startup" }, CancellationToken.None);
        var lastSuccessful = service.LastSuccessfulRunUtc;
        Assert.NotNull(lastSuccessful);

        _stub!.Result.Rows.RemoveRange(10, 90);   // 90 of 100 would now be deactivated → the guard trips
        var aborted = await service.SyncAsync(new CustomerSyncOptions { Trigger = "scheduled" }, CancellationToken.None);

        var lastRun = service.LastRun!;
        Assert.Equal("aborted", lastRun.Outcome);
        Assert.Equal("scheduled", lastRun.Trigger);
        Assert.Equal("CUSTOMER_SYNC_GUARD_TRIPPED", lastRun.AbortCode);
        Assert.Equal(aborted.AbortReason, lastRun.AbortReason);
        Assert.Same(aborted, lastRun.Result);
        Assert.Equal(lastSuccessful, service.LastSuccessfulRunUtc);
    }

    [Fact]
    public async Task SyncAsync_SourceFailure_RecordsLastRunAborted_WithTheSourceCode()
    {
        AppCustomer(1);
        UseStub(CustomerSyncSourceResult.Failed(CustomerSyncSources.Ctrm, "CUSTOMER_SYNC_NO_PERMISSION", "Customers.Read.All missing"), CustomerSyncSources.Ctrm);
        _settings[CustomerSyncSources.ConfigKey] = "ctrm";
        var service = CreateService();

        await service.SyncAsync(CancellationToken.None);

        Assert.Equal("aborted", service.LastRun!.Outcome);
        Assert.Equal("manual", service.LastRun.Trigger);
        Assert.Equal(CustomerSyncSources.Ctrm, service.LastRun.Source);
        Assert.Equal("CUSTOMER_SYNC_NO_PERMISSION", service.LastRun.AbortCode);
        Assert.Null(service.LastSuccessfulRunUtc);
    }

    [Fact]
    public async Task SyncAsync_RepositoryThrows_RecordsLastRunFailed_WithTheExceptionTypeOnly_AndRethrows()
    {
        _repo.Setup(r => r.LoadAppCustomersAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("secret"));
        var service = CreateService();

        var thrown = await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.SyncAsync(new CustomerSyncOptions { Trigger = "scheduled" }, CancellationToken.None));

        Assert.Equal("secret", thrown.Message);
        var lastRun = service.LastRun!;
        Assert.Equal("failed", lastRun.Outcome);
        Assert.Equal("scheduled", lastRun.Trigger);
        Assert.Equal(CustomerSyncSources.Ods, lastRun.Source);
        Assert.Equal("InvalidOperationException", lastRun.ExceptionType);
        Assert.Null(lastRun.AbortReason);
        Assert.Null(lastRun.Result);
        Assert.DoesNotContain("secret", System.Text.Json.JsonSerializer.Serialize(lastRun));
        Assert.Null(service.LastSuccessfulRunUtc);
    }

    [Fact]
    public async Task SyncAsync_Cancelled_IsNotRecordedAsAFailedRun()
    {
        _repo.Setup(r => r.LoadAppCustomersAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new OperationCanceledException());
        var service = CreateService();

        await Assert.ThrowsAsync<OperationCanceledException>(() => service.SyncAsync(CancellationToken.None));

        Assert.Null(service.LastRun);
    }

    [Fact]
    public async Task SyncAsync_DryRun_NeverTouchesLastRun()
    {
        HundredActiveCustomers_SourceCovers(100);
        var service = CreateService();

        await service.SyncAsync(new CustomerSyncOptions { DryRun = true }, CancellationToken.None);

        Assert.Null(service.LastRun);
        Assert.Null(service.LastSuccessfulRunUtc);

        await service.SyncAsync(CancellationToken.None);
        var recorded = service.LastRun;
        _stub!.Result.Rows.Clear();   // a dry run that aborts (empty source) is not recorded either
        await service.SyncAsync(new CustomerSyncOptions { DryRun = true }, CancellationToken.None);

        Assert.Same(recorded, service.LastRun);
        Assert.Equal(recorded!.FinishedUtc, service.LastSuccessfulRunUtc);
    }

    [Fact]
    public async Task SyncAsync_DryRunThatThrows_IsNotRecorded()
    {
        _repo.Setup(r => r.LoadAppCustomersAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("secret"));
        var service = CreateService();

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SyncAsync(new CustomerSyncOptions { DryRun = true }, CancellationToken.None));

        Assert.Null(service.LastRun);
    }

    [Fact]
    public void StartedUtc_IsSetOnConstruction()
    {
        var before = DateTime.UtcNow;

        var service = CreateService();

        Assert.InRange(service.StartedUtc, before, DateTime.UtcNow);
        Assert.Equal(DateTimeKind.Utc, service.StartedUtc.Kind);
        Assert.Null(service.LastRun);
        Assert.Null(service.LastSuccessfulRunUtc);
    }

    // ── Stub feeder ──────────────────────────────────────────────────────────────────────────────

    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add((logLevel, formatter(state, exception)));
    }

    /// <summary>Attributes that set only Name, so a test can see which source row was applied.</summary>
    private sealed class NameAttributes : CustomerSyncAttributes
    {
        private readonly string _name;

        public NameAttributes(string name) => _name = name;

        public override void ApplyTo(Customer target) => target.Name = _name;
    }

    private sealed class StubSource : ICustomerSyncSource
    {
        private readonly CustomerSyncSourceResult _result;
        private readonly List<string>? _calls;

        public StubSource(string name, CustomerSyncSourceResult result, List<string>? calls = null)
        {
            Name = name;
            _result = result;
            _calls = calls;
        }

        public string Name { get; }
        public CustomerSyncSourceResult Result => _result;
        public CustomerSyncAppState? SeenAppState { get; private set; }
        public CustomerSyncLoadOptions? SeenOptions { get; private set; }

        public Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions options, CancellationToken cancellationToken)
        {
            _calls?.Add("Source.LoadAsync");
            SeenAppState = appState;
            SeenOptions = options;
            return Task.FromResult(_result);
        }
    }

    private sealed class StubFactory : ICustomerSyncSourceFactory
    {
        private readonly ICustomerSyncSource _source;

        public StubFactory(ICustomerSyncSource source) => _source = source;

        public List<string> Requested { get; } = [];

        public ICustomerSyncSource Create(string sourceName)
        {
            Requested.Add(sourceName);
            return _source;
        }
    }
}
