// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Mobile.Mapping;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// The phone's contract cards show the same pricing badge, line quantities and unpriced quantity as the desktop
/// contracts table (getPricingInfo / getDisplayPricingQty / getUnpricedQty). These pin the desktop's cases.
/// </summary>
public class MobileContractPricingTests
{
    private static ContractResponse Contract(string type, decimal qty = 25_000) => new() { Id = 1, ContractNumber = "C1", SourceContractId = "S1", PriceTypeCode = type, Quantity = qty };
    private static ContractPricingLineResponse Line(int seq, decimal? qty, decimal? flat = null, decimal? basis = null) =>
        new() { ContractId = "S1", PriceSequence = seq, PriceQuantity = qty, FlatPrice = flat, BasisPrice = basis };

    [Fact]
    public void FlatPriced_ShowsTheFirstLinesCashPrice_ElsePriced()
    {
        Assert.Equal(("Flat", 4.125m, (decimal?)null), ContractPricing.Info(Contract("P"), [Line(1, 0, flat: 4.125m)]));
        Assert.Equal(("Priced", (decimal?)null, (decimal?)null), ContractPricing.Info(Contract("P"), []));
    }

    [Fact]
    public void Deferred_IsDeferred() =>
        Assert.Equal("Deferred", ContractPricing.Info(Contract("D"), [Line(0, 0)]).Status);

    [Fact]
    public void Unpriced_WithSomeLinesPriced_IsPartial_AndFullyPricedWithinABushel_IsPriced()
    {
        Assert.Equal("Partial", ContractPricing.Info(Contract("U"), [Line(0, 0), Line(1, 375), Line(2, 5_000)]).Status);
        Assert.Equal("Priced", ContractPricing.Info(Contract("U", 10_000), [Line(1, 9_999.5m)]).Status);
    }

    [Fact]
    public void Unpriced_SingleLineWithARealBasis_ShowsTheBasis_ButAZeroBasisIsJustUnpriced()
    {
        Assert.Equal(("Unpriced", (decimal?)null, -0.35m), ContractPricing.Info(Contract("U"), [Line(0, 0, basis: -0.35m)]));
        Assert.Equal(("Unpriced", (decimal?)null, (decimal?)null), ContractPricing.Info(Contract("U"), [Line(0, 0, basis: 0m)]));
    }

    [Fact]
    public void ZeroQuantityLines_ShowTheContractQuantity_OrTheUnpricedRemainder()
    {
        var c = Contract("U");
        var single = Line(0, 0);
        Assert.Equal(25_000m, ContractPricing.DisplayQuantity(c, single, [single]));

        var placeholder = Line(0, 0);
        IReadOnlyList<ContractPricingLineResponse> lines = [placeholder, Line(1, 375), Line(2, 5_000)];
        Assert.Equal(19_625m, ContractPricing.DisplayQuantity(c, placeholder, lines)); // the lines add up to 25,000
    }

    [Fact]
    public void UnpricedQuantity_OnlyForUnpricedContracts()
    {
        Assert.Equal(19_625m, ContractPricing.UnpricedQuantity(Contract("U"), [Line(0, 0), Line(1, 375), Line(2, 5_000)]));
        Assert.Null(ContractPricing.UnpricedQuantity(Contract("P"), [Line(1, 25_000, flat: 4m)]));
    }
}
