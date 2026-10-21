using System.Collections;
using System.ComponentModel.DataAnnotations;
using System.Reflection;

using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Data-annotation rules for <see cref="UpsertBidSheetBidRequest"/>, the shape every Edit Bids save
/// posts to <c>bidsheet/bids/bulk</c>, plus a convention over every request model.
///
/// The convention exists because of a defect found the day the Bid Sheet remodel went to PROD
/// (2026-10-20): <c>LocationId</c> had been inserted between <c>Name</c>'s <c>[MaxLength(200)]</c> and
/// <c>Name</c> itself, so the attribute silently moved onto an <c>int?</c>. <see cref="MaxLengthAttribute"/>
/// accepts only strings and collections and throws <see cref="InvalidCastException"/> for anything
/// else, which MVC's validator surfaced as a 500 on every bulk save that carried a location id --
/// which is every save from the grid. It compiled, every unit test passed, and nothing noticed until
/// a person edited a bid. Only a request that actually sets the property can catch it, so the
/// convention checks the attribute placement itself rather than relying on a value being sent.
/// </summary>
public class UpsertBidSheetBidRequestValidationTests
{
    private static List<ValidationResult> Validate(object req)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(req, new ValidationContext(req), results, validateAllProperties: true);
        return results;
    }

    private static UpsertBidSheetBidRequest GridSave(int? locationId = 42, string? name = null) => new()
    {
        LocationId = locationId,
        Name = name,
        CommodityCode = "YC",
        CropYear = 2026,
        Month = 12,
        Bid = "",
        BasisBid = "-65Z"
    };

    [Fact]
    public void ASaveFromTheGrid_WithALocationId_ValidatesCleanly()
    {
        // The exact shape the Edit Bids grid posts: id set, no name. This threw before the fix.
        var results = Validate(GridSave(locationId: 42));

        Assert.Empty(results);
    }

    [Fact]
    public void ALegacySave_ByName_StillRejectsAnOverlongName()
    {
        // The limit the attribute was always meant to enforce still holds on the string it belongs to.
        var results = Validate(GridSave(locationId: null, name: new string('x', 201)));

        var only = Assert.Single(results);
        Assert.Contains(nameof(UpsertBidSheetBidRequest.Name), only.MemberNames);
    }

    [Fact]
    public void ALegacySave_ByName_WithinTheLimit_ValidatesCleanly()
    {
        Assert.Empty(Validate(GridSave(locationId: null, name: new string('x', 200))));
    }

    /// <summary>
    /// Length attributes sit only on strings and collections, on every request model in the API. A
    /// misplaced one is not a validation failure, it is an exception on the request path, so this
    /// has to be caught at build time rather than by a 500 in an environment.
    /// </summary>
    [Fact]
    public void LengthAttributes_OnEveryRequestModel_SitOnlyOnStringsAndCollections()
    {
        var requestTypes = typeof(UpsertBidSheetBidRequest).Assembly
            .GetTypes()
            .Where(t => t.Namespace == typeof(UpsertBidSheetBidRequest).Namespace && (t.IsClass || t.IsValueType) && !t.IsEnum)
            .ToList();

        Assert.NotEmpty(requestTypes);

        var misplaced = new List<string>();
        foreach (var type in requestTypes)
        {
            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var hasLengthRule = prop.GetCustomAttributes(inherit: true).Any(a =>
                    a is MaxLengthAttribute || a is MinLengthAttribute || a is StringLengthAttribute);
                if (!hasLengthRule) continue;

                var pt = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                var ok = pt == typeof(string) || typeof(IEnumerable).IsAssignableFrom(pt);
                if (!ok) misplaced.Add($"{type.Name}.{prop.Name} ({pt.Name})");
            }
        }

        Assert.True(misplaced.Count == 0,
            "Length attributes on non-string, non-collection properties (MaxLength/MinLength/StringLength " +
            "throw InvalidCastException for these at request time): " + string.Join(", ", misplaced));
    }
}
