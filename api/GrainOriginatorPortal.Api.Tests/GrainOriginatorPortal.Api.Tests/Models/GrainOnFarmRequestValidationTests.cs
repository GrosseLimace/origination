using System.ComponentModel.DataAnnotations;

using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Data-annotation rules for grain-on-farm rows on <see cref="UpsertProducerDetailsRequest"/>. The decimal
/// fields use the double <see cref="RangeAttribute"/> overload on purpose: the int overload converts the value
/// with Convert.ToInt32, which throws OverflowException past int.MaxValue — a 500 from the validation pipeline
/// instead of the 400 [ApiController] should return (review 2026-10-09).
/// </summary>
public class GrainOnFarmRequestValidationTests
{
    private static List<ValidationResult> Validate(object req)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(req, new ValidationContext(req), results, validateAllProperties: true);
        return results;
    }

    private static GrainOnFarmItemRequest Row(decimal? onHand = null, decimal? sold = null, decimal? target = null, decimal? lastBid = null) =>
        new() { CommodityCode = "YC", BushelsOnHand = onHand, BushelsSold = sold, TargetBushels = target, LastBid = lastBid };

    [Fact]
    public void TypicalValues_AreAccepted()
    {
        Assert.Empty(Validate(Row(onHand: 30_000m, sold: 10_000m, target: 4.25m, lastBid: -0.35m)));
    }

    [Fact]
    public void ZeroAndNegativeBids_AreAccepted()
    {
        // A basis bid or target can be zero or negative.
        Assert.Empty(Validate(Row(target: 0m, lastBid: -1.1525m)));
    }

    [Theory]
    [InlineData("3000000000")]   // past int.MaxValue — used to throw OverflowException
    [InlineData("1000000000.5")] // past the ceiling by a fraction — used to round down to "valid"
    [InlineData("-1")]
    public void BushelsOutOfRange_IsRejectedNotThrown(string value)
    {
        var v = decimal.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
        Assert.Single(Validate(Row(onHand: v)), r => r.MemberNames.Contains(nameof(GrainOnFarmItemRequest.BushelsOnHand)));
        Assert.Single(Validate(Row(sold: v)), r => r.MemberNames.Contains(nameof(GrainOnFarmItemRequest.BushelsSold)));
    }

    [Theory]
    [InlineData("3000000000")]
    [InlineData("-3000000000")]
    public void BidsOutOfRange_IsRejectedNotThrown(string value)
    {
        var v = decimal.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
        Assert.Single(Validate(Row(target: v)), r => r.MemberNames.Contains(nameof(GrainOnFarmItemRequest.TargetBushels)));
        Assert.Single(Validate(Row(lastBid: v)), r => r.MemberNames.Contains(nameof(GrainOnFarmItemRequest.LastBid)));
    }

    [Fact]
    public void TotalAcresPastIntMax_IsRejectedNotThrown()
    {
        var req = new UpsertProducerDetailsRequest { CustomerName = "Farm", TotalAcres = 3_000_000_000m };
        Assert.Single(Validate(req), r => r.MemberNames.Contains(nameof(UpsertProducerDetailsRequest.TotalAcres)));
    }

    [Fact]
    public void GrainList_IsCappedAt2000Rows()
    {
        var rows = Enumerable.Range(0, 2001).Select(_ => Row(onHand: 1m)).ToList();
        var req = new UpsertProducerDetailsRequest { CustomerName = "Farm", GrainOnFarm = rows };
        Assert.Single(Validate(req), r => r.MemberNames.Contains(nameof(UpsertProducerDetailsRequest.GrainOnFarm)));
        Assert.Empty(Validate(new UpsertProducerDetailsRequest { CustomerName = "Farm", GrainOnFarm = rows.Take(2000).ToList() }));
    }
}
