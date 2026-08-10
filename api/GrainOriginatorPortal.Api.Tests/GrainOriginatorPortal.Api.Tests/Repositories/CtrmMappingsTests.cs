// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the CTRM → entity projection. These are the rules that decide whether a producer's screen
/// looks the same whichever source is behind it, so each test pins a specific way the two paths
/// could silently diverge.
/// </summary>
public class CtrmMappingsTests
{
    private static readonly DateTime Today = new(2026, 8, 10);

    private static CtrmContractDto Dto(
        string contractId = "PWW227420",
        string prefix = "P",
        string customerId = "TATOBIN",
        DateTime? closedDate = null,
        DateTime? start = null,
        DateTime? end = null,
        int? cropYear = 2026) => new()
    {
        ContractId = contractId,
        ContractPrefixType = prefix,
        ContractNumber = "W227420",
        CustomerId = customerId,
        CommodityCode = "CORN",
        ContractDate = new DateTime(2026, 3, 20),
        StartShipDate = start,
        FinalShipDate = end,
        ClosedDate = closedDate,
        CropYear = cropYear,
        Quantity = 1000m,
        QuantityUom = "BU",
        OpenBalanceQuantity = 1000m,
        SettledQuantity = 0m,
        PriceTypeCode = "P"
    };

    // -------------------------------------------------------------------------
    [Fact]
    public void SentinelClosedDate_BecomesNull_SoOpenContractsReadAsOpen()
    {
        // Db2's unset-date convention. Left alone, every open contract would look closed.
        var result = CtrmMappings.ToContracts([Dto(closedDate: new DateTime(1, 1, 1))], Today);

        Assert.Null(Assert.Single(result).ClosedDate);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void RealClosedDate_IsPreserved()
    {
        var closed = new DateTime(2026, 1, 17);

        var result = CtrmMappings.ToContracts([Dto(closedDate: closed)], Today);

        Assert.Equal(closed, Assert.Single(result).ClosedDate);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void NonPurchaseContracts_AreDropped()
    {
        // There is no contractPrefixType argument on the CTRM query, so sale contracts arrive in the
        // window and have to be filtered here — every contract screen in the app is purchase-only.
        var result = CtrmMappings.ToContracts([Dto(prefix: "P"), Dto(contractId: "SEW659816", prefix: "S")], Today);

        Assert.Equal("PWW227420", Assert.Single(result).SourceContractId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void PairedSaleAndPurchase_ShareAContractNumber_ButOnlyThePurchaseSurvives()
    {
        // Real observed data: SEW659816 and PEW659816. contractNumber alone is not unique, which is
        // why contractId is the key everywhere.
        var sale = Dto(contractId: "SEW659816", prefix: "S");
        var purchase = Dto(contractId: "PEW659816", prefix: "P");

        var result = CtrmMappings.ToContracts([sale, purchase], Today);

        Assert.Equal("PEW659816", Assert.Single(result).SourceContractId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void RowsWithoutAContractId_AreDropped()
    {
        var result = CtrmMappings.ToContracts([Dto(contractId: "  ")], Today);

        Assert.Empty(result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void CustomerCode_IsMappedToCtrmCustomerId_TrimmedForTheOdsJoin()
    {
        // CTRM customerId, ODS CustomerCode and Customer.ScoularId are one namespace. Downstream code
        // string-matches on it, and the ODS side trims on read, so an untrimmed value here would
        // silently fail to match.
        var result = CtrmMappings.ToContracts([Dto(customerId: "  TATOBIN  ")], Today);

        Assert.Equal("TATOBIN", Assert.Single(result).CtrmCustomerId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void SignedIsTrue_AndOdsIgnoredFieldsStayUnset()
    {
        // Signed mirrors the ODS path's hardcoded default. Price and Weight are Ignore()d on the ODS
        // entity, so populating them from CTRM would make the source comparison show a
        // field-population difference rather than a data difference.
        var contract = Assert.Single(CtrmMappings.ToContracts([Dto()], Today));

        Assert.True(contract.Signed);
        Assert.Null(contract.Price);
        Assert.Null(contract.Weight);
        Assert.True(contract.IsActive);
        Assert.False(contract.IsDeleted);
    }

    // -------------------------------------------------------------------------
    [Theory]
    // Delivery window entirely in the future → nothing shipped yet.
    [InlineData("2026-09-01", "2026-09-30", ContractStatus.Pending)]
    // Today sits inside the window.
    [InlineData("2026-08-01", "2026-08-31", ContractStatus.Active)]
    // Window closed before today and we cannot prove delivery, so it reads as overdue.
    [InlineData("2026-06-01", "2026-06-30", ContractStatus.Overdue)]
    public void Status_IsDerivedFromTheDeliveryWindow(string start, string end, ContractStatus expected)
    {
        var dto = Dto(start: DateTime.Parse(start), end: DateTime.Parse(end));

        var result = CtrmMappings.ToContracts([dto], Today);

        Assert.Equal(expected, Assert.Single(result).Status);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void MissingDeliveryDates_FallBackToPending()
    {
        var contract = Assert.Single(CtrmMappings.ToContracts([Dto(start: null, end: null)], Today));

        Assert.Equal(ContractStatus.Pending, contract.Status);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void PricingLines_CarryTheParentContractIdAndFreightAdjustment()
    {
        // FreightAdjustment is the clear win: the ODS path needs a second query against
        // base.ContractPrice to get it, keyed on (SourceContractId, PriceSequence).
        var dto = Dto();
        dto.Prices.Add(new CtrmContractPriceDto
        {
            PriceSequence = 0,
            PriceQuantity = 1000m,
            FlatPrice = 5.62m,
            BasisPrice = -0.0075m,
            HedgePrice = 5.6275m,
            FreightAdjustment = 0.15m,
            PriceDate = new DateTime(1, 1, 1)
        });

        var line = Assert.Single(CtrmMappings.ToPricingLines([dto]));

        Assert.Equal("PWW227420", line.ContractId);
        Assert.Equal(0.15m, line.FreightAdjustment);
        Assert.Equal(5.62m, line.FlatPrice);
        // priceSequence 0 is a real sequence on live data, not a missing value.
        Assert.Equal(0, line.PriceSequence);
        // Sentinel handling applies to price dates too.
        Assert.Null(line.PriceDate);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void PricingLines_FromNonPurchaseContracts_AreDropped()
    {
        // Without the same prefix filter the headers get, a sale contract's prices would leak into a
        // producer's pricing view even though its header was filtered out.
        var sale = Dto(contractId: "SEW659816", prefix: "S");
        sale.Prices.Add(new CtrmContractPriceDto { PriceSequence = 1, FlatPrice = 9.99m });

        Assert.Empty(CtrmMappings.ToPricingLines([sale]));
    }
}
