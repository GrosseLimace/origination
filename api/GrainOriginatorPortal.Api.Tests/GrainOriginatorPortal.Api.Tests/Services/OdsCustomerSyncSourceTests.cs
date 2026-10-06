// Third-party namespaces
using Moq;
using Xunit;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The ODS feeder is a behaviour-preserving extraction of what <c>CustomerSyncService</c> read from the
/// ODS: every <c>vw_CustomerTradeUnits</c> row unchanged, and the <c>base.vw_CurrentCustomers</c>
/// lookup for manual customers outside the view.
/// </summary>
public class OdsCustomerSyncSourceTests
{
    private readonly Mock<ICustomerSyncRepository> _repo = new(MockBehavior.Strict);

    private OdsCustomerSyncSource Sut() => new(_repo.Object);

    private void ViewReturns(params CustomerTradeUnitView[] rows) =>
        _repo.Setup(r => r.LoadOdsTradeUnitRowsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(rows.ToList());

    private void MasterReturns(long[] expectedIds, params CurrentCustomerRow[] rows) =>
        _repo.Setup(r => r.LoadCurrentCustomerMasterAsync(
                It.Is<IReadOnlyCollection<long>>(ids => ids.SequenceEqual(expectedIds)), It.IsAny<CancellationToken>()))
            .ReturnsAsync(rows.ToList());

    private static CustomerSyncAppState AppState(params Customer[] customers) =>
        new() { Customers = customers, TradeUnits = [] };

    private static CustomerTradeUnitView ViewRow(long customerId, string? tradeUnit, string name = "Farm") =>
        new() { CustomerId = customerId, TradeUnit = tradeUnit, CustomerName = name, ScoularId = $"S{customerId}" };

    private static Customer Manual(long id, bool isActive = true) => new() { Id = id, Name = "Old", IsManual = true, IsActive = isActive };

    private static Customer Applied(CustomerSyncAttributes attributes)
    {
        var target = new Customer();
        attributes.ApplyTo(target);
        return target;
    }

    [Fact]
    public async Task LoadAsync_MapsEveryViewRow_KeyedByOdsCustomerId()
    {
        ViewReturns(ViewRow(1, "1085", "One"), ViewRow(1, " 2200 ", "One"), ViewRow(2, "3300", "Two"));

        var result = await Sut().LoadAsync(AppState(), CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(CustomerSyncSources.Ods, result.Source);
        Assert.Collection(result.Rows,
            r => { Assert.Equal(1, r.CustomerId); Assert.Equal("1085", r.TradeUnit); Assert.IsType<OdsCustomerSyncAttributes>(r.Attributes); Assert.Equal("One", Applied(r.Attributes).Name); },
            r => { Assert.Equal(1, r.CustomerId); Assert.Equal(" 2200 ", r.TradeUnit); Assert.IsType<OdsCustomerSyncAttributes>(r.Attributes); },
            r => { Assert.Equal(2, r.CustomerId); Assert.Equal("3300", r.TradeUnit); Assert.IsType<OdsCustomerSyncAttributes>(r.Attributes); Assert.Equal("Two", Applied(r.Attributes).Name); });
    }

    [Fact]
    public async Task LoadAsync_ManualCustomersOutsideTheView_AreLookedUpInTheMaster()
    {
        // Same set the service used to query: IsManual (active or not) and not present in the view.
        // A manual customer IN the view (1) and a synced customer outside it (5) are not looked up.
        ViewReturns(ViewRow(1, "1085"));
        MasterReturns([900, 901],
            new CurrentCustomerRow { CustomerId = 900, CustomerName = "Nine Hundred" },
            new CurrentCustomerRow { CustomerId = 901, CustomerName = "Nine Oh One" });
        var appState = AppState(Manual(1), new Customer { Id = 5, IsActive = true }, Manual(900), Manual(901, isActive: false));

        var result = await Sut().LoadAsync(appState, CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.True(result.ManualMasterComplete);
        Assert.Empty(result.ManualUnverifiable);
        Assert.Equal([900L, 901L], result.ManualMaster.Keys.Order());
        Assert.IsType<OdsCustomerSyncAttributes>(result.ManualMaster[900]);
        Assert.Equal("Nine Hundred", Applied(result.ManualMaster[900]).Name);
        Assert.Equal("Nine Oh One", Applied(result.ManualMaster[901]).Name);
        _repo.Verify(r => r.LoadCurrentCustomerMasterAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task LoadAsync_ManualCustomerMissingFromMaster_IsAbsentFromManualMaster()
    {
        // The caller deactivates it, as today: the master is complete, the customer is simply gone.
        ViewReturns(ViewRow(1, "1085"));
        MasterReturns([900, 901], new CurrentCustomerRow { CustomerId = 901, CustomerName = "Still Here" });

        var result = await Sut().LoadAsync(AppState(Manual(900), Manual(901)), CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.False(result.ManualMaster.ContainsKey(900));
        Assert.True(result.ManualMaster.ContainsKey(901));
        Assert.True(result.ManualMasterComplete);
        Assert.Empty(result.ManualUnverifiable);
    }

    [Fact]
    public async Task LoadAsync_NoManualCustomers_DoesNotQueryTheMaster()
    {
        // The only manual customer is in the view, so no one is outside it to look up.
        ViewReturns(ViewRow(1, "1085"));

        var result = await Sut().LoadAsync(AppState(Manual(1), new Customer { Id = 5, IsActive = true }), CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Empty(result.ManualMaster);
        Assert.True(result.ManualMasterComplete);
        _repo.Verify(r => r.LoadCurrentCustomerMasterAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
