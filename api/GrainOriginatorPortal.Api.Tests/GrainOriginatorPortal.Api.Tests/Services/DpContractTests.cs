// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the two pieces of DP-contract logic that carry real risk: the bushel conversion (which
/// must refuse to guess) and the entitlement scoping on the list endpoint (which must fail closed).
/// </summary>
public class DpBushelConversionTests
{
    // 56 lbs/bu corn, 60 lbs/bu soybeans — realistic factors from ctrm.vw_GNP024.
    private static readonly Dictionary<string, decimal> Factors = new(StringComparer.OrdinalIgnoreCase)
    {
        ["YC"] = 56m,
        ["SOY"] = 60m,
    };

    [Fact]
    public void ToBushels_WhenUomIsBushels_ReturnsQuantityUnchanged()
    {
        var result = DpBushelConversion.ToBushels(1_250m, "BU", "YC", Factors);

        Assert.Equal(1_250m, result);
    }

    [Fact]
    public void ToBushels_WhenUomIsBushels_DoesNotNeedAConversionFactor()
    {
        // A commodity absent from vw_GNP024 must still report bushels when the source unit already
        // IS bushels — otherwise a missing reference row would blank out a perfectly good figure.
        var result = DpBushelConversion.ToBushels(500m, "BU", "ZZZ", Factors);

        Assert.Equal(500m, result);
    }

    [Fact]
    public void ToBushels_WhenUomIsPounds_DividesByLbsPerBushel()
    {
        var result = DpBushelConversion.ToBushels(5_600m, "LB", "YC", Factors);

        Assert.Equal(100m, result);
    }

    [Fact]
    public void ToBushels_WhenUomIsHundredweight_ScalesToPoundsFirst()
    {
        // 56 cwt = 5,600 lbs = 100 bu of corn.
        var result = DpBushelConversion.ToBushels(56m, "CW", "YC", Factors);

        Assert.Equal(100m, result);
    }

    [Fact]
    public void ToBushels_WhenUomIsTons_ScalesToPoundsFirst()
    {
        // 3 tons = 6,000 lbs = 100 bu of soybeans.
        var result = DpBushelConversion.ToBushels(3m, "TN", "SOY", Factors);

        Assert.Equal(100m, result);
    }

    [Fact]
    public void ToBushels_IgnoresCharPaddingAndCase()
    {
        // Quantity_Uom is char(2) and Commodity_Code is char(4), so both arrive space-padded.
        var result = DpBushelConversion.ToBushels(5_600m, "lb", " yc ", Factors);

        Assert.Equal(100m, result);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ToBushels_WhenUomIsBlank_ReturnsNull(string uom)
    {
        // The governing rule: never show a bushel figure we can't substantiate.
        var result = DpBushelConversion.ToBushels(1_000m, uom, "YC", Factors);

        Assert.Null(result);
    }

    [Fact]
    public void ToBushels_WhenUomIsUnrecognized_ReturnsNull()
    {
        var result = DpBushelConversion.ToBushels(1_000m, "XX", "YC", Factors);

        Assert.Null(result);
    }

    [Fact]
    public void ToBushels_WhenCommodityHasNoConversionFactor_ReturnsNull()
    {
        var result = DpBushelConversion.ToBushels(5_600m, "LB", "ZZZ", Factors);

        Assert.Null(result);
    }

    [Fact]
    public void ToBushels_WhenConversionFactorIsNotPositive_ReturnsNull()
    {
        var zeroFactor = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase) { ["YC"] = 0m };

        var result = DpBushelConversion.ToBushels(5_600m, "LB", "YC", zeroFactor);

        Assert.Null(result);
    }

    [Fact]
    public void ToBushels_WhenCommodityCodeIsBlankAndConversionNeeded_ReturnsNull()
    {
        var result = DpBushelConversion.ToBushels(5_600m, "LB", "  ", Factors);

        Assert.Null(result);
    }

    // Pins the arithmetic against a real prod row (supplied 2026-08-04):
    // Trade_Unit 1340, ticket H/370145, YC, 812.50 BU, rate 0.300000, Receivable_Amount 243.75.
    [Fact]
    public void ToBushels_MatchesTheReferenceProdRow()
    {
        var bushels = DpBushelConversion.ToBushels(812.50m, "BU", "YC  ", Factors);

        Assert.Equal(812.50m, bushels);
        // Rate is a flat charge per bushel on this row — deliberately NOT multiplied by Storage_Days.
        Assert.Equal(243.75m, bushels!.Value * 0.300000m);
        // Derived Cents/Bu shown in the group header.
        Assert.Equal(30.00m, Math.Round(243.75m / bushels.Value * 100m, 2));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(1900)]
    public void NullIfSentinel_TreatsFloorDatesAsNoDate(int year)
    {
        // The view declares every date NOT NULL, so "no date" arrives as a floor value.
        var result = DpBushelConversion.NullIfSentinel(new DateTime(year, 1, 1));

        Assert.Null(result);
    }

    [Fact]
    public void NullIfSentinel_KeepsRealDates()
    {
        var date = new DateTime(2026, 8, 4);

        var result = DpBushelConversion.NullIfSentinel(date);

        Assert.Equal(date, result);
    }
}

public class DpContractServiceTests
{
    private readonly Mock<IDpContractRepository> _repositoryMock = new();
    private readonly Mock<ICustomerRepository> _customerRepositoryMock = new();
    private readonly Mock<IUserEntitlementService> _entitlementMock = new();
    private readonly DpContractService _sut;

    public DpContractServiceTests()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        _entitlementMock
            .Setup(e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string> { "2115" });
        _sut = new DpContractService(_repositoryMock.Object, _customerRepositoryMock.Object, _entitlementMock.Object);
    }

    [Fact]
    public async Task GetAllAsync_NarrowsToProducersInEntitledTradeUnits()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new DpContract { Id = "entitled", CustomerId = 1 },
                new DpContract { Id = "not-entitled", CustomerId = 2 },
            ]);
        _customerRepositoryMock
            .Setup(c => c.GetActiveCustomerIdsInTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([1L]);

        var result = await _sut.GetAllAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("entitled", result[0].Id);
    }

    // CWE-285: an entitlements outage must refuse the request rather than return rows we can't
    // authorize. Mirrors StoredGrainService and EnforceTradeUnitAccessAttribute.
    [Fact]
    public async Task GetAllAsync_WhenEntitlementsUnavailable_FailsClosedWith503()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(false);
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DpContract { Id = "any", CustomerId = 1 }]);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("ENTITLEMENTS_DB_UNAVAILABLE", ex.ErrorCode);
        Assert.Equal(503, ex.HttpStatusCode);
    }

    // Per-producer reads are deliberately NOT entitlement-scoped — trade-unit entitlements are a UX
    // default, not an access boundary (same rule as Storage).
    [Fact]
    public async Task GetByCustomerAsync_DoesNotApplyEntitlementScoping()
    {
        _repositoryMock
            .Setup(r => r.GetByCustomerAsync(42L, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DpContract { Id = "row", CustomerId = 42 }]);

        var result = await _sut.GetByCustomerAsync(42L, CancellationToken.None);

        Assert.Single(result);
        _customerRepositoryMock.Verify(
            c => c.GetActiveCustomerIdsInTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    // Regression: a delivery can carry two rows with the SAME Status ('S' / "REGULAR STG RATE") that
    // differ only by charge PERIOD — a zero-rate free window then the real accrual. Real prod row set
    // (ticket 364877): $0.00 for 2023-10-09→2024-01-31, then $782.13 for 2024-02-01→2026-08-12.
    // Both must survive to the response, and their charges must add up.
    [Fact]
    public async Task GetByCustomerAsync_KeepsBothChargePeriodsOfOneDelivery()
    {
        const string ticketKey = "T|364877||277773493|1085";
        _repositoryMock
            .Setup(r => r.GetByCustomerAsync(7L, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new DpContract
                {
                    Id = $"{ticketKey}|S|20231009", TicketKey = ticketKey, CustomerId = 7,
                    TicketNumber = "364877", Crop = "YSB", Quantity = 423.23m, Bushels = 423.23m,
                    Status = "S", StatusDescription = "REGULAR STG RATE",
                    StorageDays = 115, StorageRate = 0m, ReceivableAmount = 0m,
                    ChargedFromDate = new DateTime(2023, 10, 9), ChargedThruDate = new DateTime(2024, 1, 31),
                },
                new DpContract
                {
                    Id = $"{ticketKey}|S|20240201", TicketKey = ticketKey, CustomerId = 7,
                    TicketNumber = "364877", Crop = "YSB", Quantity = 423.23m, Bushels = 423.23m,
                    Status = "S", StatusDescription = "REGULAR STG RATE",
                    StorageDays = 924, StorageRate = 0.002m, ReceivableAmount = 782.13m,
                    ChargedFromDate = new DateTime(2024, 2, 1), ChargedThruDate = new DateTime(2026, 8, 12),
                },
            ]);

        var result = await _sut.GetByCustomerAsync(7L, CancellationToken.None);

        Assert.Equal(2, result.Count);                                  // neither row dropped
        Assert.Equal(2, result.Select(r => r.Id).Distinct().Count());    // ids unique (Angular track key)
        Assert.Equal(782.13m, result.Sum(r => r.ReceivableAmount));      // the money survives
        Assert.All(result, r => Assert.Equal(423.23m, r.Bushels));       // quantity repeats per row
    }

    [Fact]
    public async Task GetByCustomerAsync_MapsNullBushelsAndSentinelDatesThrough()
    {
        _repositoryMock
            .Setup(r => r.GetByCustomerAsync(42L, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new DpContract
                {
                    Id = "row",
                    CustomerId = 42,
                    Quantity = 1_000m,
                    QuantityUom = "XX",
                    Bushels = null,
                    ChargedFromDate = new DateTime(1, 1, 1),
                    ChargedThruDate = new DateTime(2026, 8, 4),
                },
            ]);

        var result = await _sut.GetByCustomerAsync(42L, CancellationToken.None);

        var row = Assert.Single(result);
        Assert.Null(row.Bushels);
        Assert.Equal(1_000m, row.Quantity);
        Assert.Null(row.ChargedFromDate);
        Assert.Equal(new DateTime(2026, 8, 4), row.ChargedThruDate);
    }
}
