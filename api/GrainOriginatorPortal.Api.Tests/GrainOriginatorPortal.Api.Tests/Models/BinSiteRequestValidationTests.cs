using System.ComponentModel.DataAnnotations;

using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Data-annotation rules for bin sites on <see cref="UpsertProducerDetailsRequest"/>: the North
/// American box (latitude 7..84 north, longitude -180..-52 west), a 100-character name, and at most
/// three sites per producer. [ApiController] turns any of these into an automatic 400.
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
        BinSites = Enumerable.Range(0, count).Select(i => Site(39m + i, -95m)).ToList(),
    };

    [Fact]
    public void ThreeSites_AreAccepted()
    {
        Assert.Empty(Validate(WithSites(3)));
    }

    [Fact]
    public void FourthSite_IsRejected()
    {
        var errors = Validate(WithSites(4));

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(UpsertProducerDetailsRequest.BinSites)));
    }
}
