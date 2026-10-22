// Microsoft namespaces
using Microsoft.Extensions.Logging.Abstractions;

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

    private OdsCustomerSyncSource Sut() => new(_repo.Object, NullLogger<OdsCustomerSyncSource>.Instance);

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

    // ── Adopting CTRM-minted rows by ScoularId (C3) ─────────────────────────────────────────────

    private const long Minted42 = CustomerIdMinting.ReservedBase + 42;

    private static CustomerTradeUnitView CodedViewRow(long customerId, string? tradeUnit, string? scoularId) =>
        new() { CustomerId = customerId, TradeUnit = tradeUnit, CustomerName = "Farm", ScoularId = scoularId };

    private static Customer Minted(long id, string? scoularId, bool isActive = true, bool isManual = false) =>
        new() { Id = id, ScoularId = scoularId, IsActive = isActive, IsManual = isManual };

    [Fact]
    public async Task LoadAsync_ViewRowForAnUnknownOdsId_WithAMintedRowOfTheSameScoularId_IsRemappedToTheMintedId()
    {
        ViewReturns(CodedViewRow(777, "1085", "smitfar "), CodedViewRow(777, "2200", "smitfar "));

        var result = await Sut().LoadAsync(AppState(Minted(Minted42, "SMITFAR")), CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.All(result.Rows, r => Assert.Equal(Minted42, r.CustomerId));
        Assert.Equal(["1085", "2200"], result.Rows.Select(r => r.TradeUnit));
    }

    [Fact]
    public async Task LoadAsync_ViewRowForAKnownOdsId_IsNotRemapped()
    {
        ViewReturns(CodedViewRow(777, "1085", "SMITFAR"));

        var result = await Sut().LoadAsync(
            AppState(new Customer { Id = 777, ScoularId = "SMITFAR", IsActive = true }, Minted(Minted42, "SMITFAR")),
            CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Equal(777, Assert.Single(result.Rows).CustomerId);
    }

    [Fact]
    public async Task LoadAsync_UnknownOdsId_WhoseScoularIdIsHeldOnlyByANonMintedRow_IsNotRemapped()
    {
        // Only minted rows are adopted on the sync path; a second ODS id for the same code stays as it always has.
        ViewReturns(CodedViewRow(777, "1085", "SMITFAR"));

        var result = await Sut().LoadAsync(
            AppState(new Customer { Id = 555, ScoularId = "SMITFAR", IsActive = true }),
            CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Equal(777, Assert.Single(result.Rows).CustomerId);
    }

    [Fact]
    public async Task LoadAsync_UnknownOdsId_WithBlankScoularId_IsNotRemapped()
    {
        ViewReturns(CodedViewRow(777, "1085", null), CodedViewRow(778, "1085", "  "));

        var result = await Sut().LoadAsync(AppState(Minted(Minted42, null), Minted(Minted42 + 1, " ")), CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Equal([777L, 778L], result.Rows.Select(r => r.CustomerId));
    }

    [Theory]
    [InlineData(false, true, CustomerIdMinting.ReservedBase + 9)]    // the active row wins over a lower inactive id
    [InlineData(true, true, CustomerIdMinting.ReservedBase + 1)]     // both active → lowest id
    [InlineData(false, false, CustomerIdMinting.ReservedBase + 1)]   // both inactive → lowest id
    public async Task LoadAsync_SeveralMintedRowsShareTheScoularId_PrefersActiveThenLowestId(bool lowActive, bool highActive, long expected)
    {
        ViewReturns(CodedViewRow(777, "1085", "SMITFAR"));

        var result = await Sut().LoadAsync(
            AppState(Minted(CustomerIdMinting.ReservedBase + 9, "SMITFAR", highActive), Minted(CustomerIdMinting.ReservedBase + 1, "smitfar", lowActive)),
            CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Equal(expected, Assert.Single(result.Rows).CustomerId);
    }

    [Fact]
    public async Task LoadAsync_MintedManualCustomers_AreUnverifiable_NotLookedUp()
    {
        ViewReturns(ViewRow(1, "1085"));
        MasterReturns([900], new CurrentCustomerRow { CustomerId = 900, CustomerName = "Nine Hundred" });

        var result = await Sut().LoadAsync(
            AppState(Manual(900), Minted(Minted42, "NEWGUY1", isManual: true)),
            CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Equal([Minted42], result.ManualUnverifiable);
        Assert.Equal([900L], result.ManualMaster.Keys);
        Assert.True(result.ManualMasterComplete);
        _repo.Verify(r => r.LoadCurrentCustomerMasterAsync(
            It.Is<IReadOnlyCollection<long>>(ids => !ids.Contains(Minted42)), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task LoadAsync_OnlyMintedManualCustomersOutsideTheView_DoesNotQueryTheMaster()
    {
        ViewReturns(ViewRow(1, "1085"));

        var result = await Sut().LoadAsync(AppState(Minted(Minted42, "NEWGUY1", isManual: true)), CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Equal([Minted42], result.ManualUnverifiable);
        _repo.Verify(r => r.LoadCurrentCustomerMasterAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task LoadAsync_MintedManualCustomerAdoptedFromTheView_IsInTheRows_NotUnverifiable()
    {
        // The adopted rows put the minted id in the view, so the service graduates it like any manual
        // customer with activity; it is neither looked up in the master nor marked unverifiable.
        ViewReturns(CodedViewRow(777, "1085", "SMITFAR"));

        var result = await Sut().LoadAsync(AppState(Minted(Minted42, "SMITFAR", isManual: true)), CustomerSyncLoadOptions.Default, CancellationToken.None);

        Assert.Equal(Minted42, Assert.Single(result.Rows).CustomerId);
        Assert.Empty(result.ManualUnverifiable);
        _repo.Verify(r => r.LoadCurrentCustomerMasterAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
