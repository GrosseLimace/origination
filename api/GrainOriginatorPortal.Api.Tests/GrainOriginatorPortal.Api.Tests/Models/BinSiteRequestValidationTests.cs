using System.ComponentModel.DataAnnotations;

using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Data-annotation rules for bin sites on <see cref="UpsertProducerDetailsRequest"/>: the North
/// American box (latitude 7..84 north, longitude -180..-52 west), a 100-character name, and a
/// 100-site sanity ceiling (not a product limit). [ApiController] turns any of these into an automatic 400.
/// </summary>
public class BinSiteRequestValidationTests
{
    // Validator.TryValidateObject does not recurse into collection items (MVC model binding does),
    // so items are validated on their own.
    private static List<ValidationResult> Validate(object req)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(req, new ValidationContext(req), results, validateAllProperties: true);
        return results;
    }

    private static BinSiteItemRequest Site(decimal lat, decimal lng, string? name = null) =>
        new() { Name = name, Latitude = lat, Longitude = lng };

    // ── Latitude ───────────────────────────────────────────────────────────────
    [Theory]
    [InlineData("7")]
    [InlineData("39.115876")]
    [InlineData("84")]
    public void Latitude_InsideNorthAmerica_IsAccepted(string lat)
    {
        Assert.Empty(Validate(Site(decimal.Parse(lat), -95.143955m)));
    }

    [Theory]
    [InlineData("6.999999")]  // south of Panama
    [InlineData("84.000001")] // past the Canadian Arctic
    [InlineData("-39.115876")] // southern hemisphere
    public void Latitude_OutsideNorthAmerica_IsRejected(string lat)
    {
        var errors = Validate(Site(decimal.Parse(lat), -95.143955m));

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(BinSiteItemRequest.Latitude)));
    }

    // ── Longitude ──────────────────────────────────────────────────────────────
    [Theory]
    [InlineData("-180")]
    [InlineData("-95.143955")]
    [InlineData("-52")]
    public void Longitude_InsideNorthAmerica_IsAccepted(string lng)
    {
        Assert.Empty(Validate(Site(39.115876m, decimal.Parse(lng))));
    }

    [Theory]
    [InlineData("95.143955")]   // dropped minus sign
    [InlineData("-51.999999")]  // east of Newfoundland
    [InlineData("-180.000001")]
    public void Longitude_OutsideNorthAmerica_IsRejected(string lng)
    {
        var errors = Validate(Site(39.115876m, decimal.Parse(lng)));

        var error = Assert.Single(errors, e => e.MemberNames.Contains(nameof(BinSiteItemRequest.Longitude)));
        Assert.Contains("negative", error.ErrorMessage);
    }

    [Fact]
    public void SwappedPair_IsRejectedOnBothFields()
    {
        var errors = Validate(Site(-95.143955m, 39.115876m));

        Assert.Equal(2, errors.Count);
    }

    // ── Name ───────────────────────────────────────────────────────────────────
    [Fact]
    public void Name_IsOptional()
    {
        Assert.Empty(Validate(Site(39.1m, -95.1m, name: null)));
    }

    [Fact]
    public void Name_Over100Characters_IsRejected()
    {
        var errors = Validate(Site(39.1m, -95.1m, name: new string('x', 101)));

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(BinSiteItemRequest.Name)));
    }

    // ── Count ──────────────────────────────────────────────────────────────────
    private static UpsertProducerDetailsRequest WithSites(int count) => new()
    {
        CustomerName = "Smith Farm",
        BinSites = Enumerable.Range(0, count).Select(i => Site(39m + i * 0.01m, -95m)).ToList(),
    };

    [Theory]
    [InlineData(4)]   // the old three-site product limit is gone
    [InlineData(25)]
    [InlineData(100)] // the sanity ceiling itself
    public void ManySites_AreAccepted(int count)
    {
        Assert.Empty(Validate(WithSites(count)));
    }

    [Fact]
    public void PastTheSanityCeiling_IsRejected()
    {
        var errors = Validate(WithSites(101));

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(UpsertProducerDetailsRequest.BinSites)));
    }

    // ── Capacity ───────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(null)]
    [InlineData("0")]
    [InlineData("50000")]
    [InlineData("100000000")]
    public void Capacity_IsOptional_AndAcceptedUpToTheBinCapacityCeiling(string? capacity)
    {
        var site = Site(39.1m, -95.1m) with { Capacity = capacity is null ? null : decimal.Parse(capacity) };

        Assert.Empty(Validate(site));
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("100000001")]
    public void Capacity_OutsideTheRange_IsRejected(string capacity)
    {
        var site = Site(39.1m, -95.1m) with { Capacity = decimal.Parse(capacity) };

        Assert.Contains(Validate(site), e => e.MemberNames.Contains(nameof(BinSiteItemRequest.Capacity)));
    }

    // ── Commodity + Marketed / Unmarketed ─────────────────────────────────────
    [Fact]
    public void CommodityAndMarketing_AreOptional_AndAcceptedInRange()
    {
        var site = Site(39.1m, -95.1m) with { CommodityCode = "YC", Marketed = 20_000m, Unmarketed = 100_000_000m };

        Assert.Empty(Validate(site));
    }

    [Theory]
    [InlineData(nameof(BinSiteItemRequest.Marketed))]
    [InlineData(nameof(BinSiteItemRequest.Unmarketed))]
    public void NegativeMarketing_IsRejected(string field)
    {
        var site = field == nameof(BinSiteItemRequest.Marketed)
            ? Site(39.1m, -95.1m) with { Marketed = -1m }
            : Site(39.1m, -95.1m) with { Unmarketed = -1m };

        Assert.Contains(Validate(site), e => e.MemberNames.Contains(field));
    }

    [Fact]
    public void CommodityCode_Over100Characters_IsRejected()
    {
        var site = Site(39.1m, -95.1m) with { CommodityCode = new string('X', 101) };

        Assert.Contains(Validate(site), e => e.MemberNames.Contains(nameof(BinSiteItemRequest.CommodityCode)));
    }
}
