// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Crop splitting, exercised against the three free-text strings from the captured payloads rather
/// than invented examples. Certifiers write these by hand with no agreed format, so real strings
/// are the only honest test data.
/// </summary>
public class OrganicCertifiedCropsTests
{
    // Verbatim from the captured samples, 2026-09-29.
    private const string CropList =
        "Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Rye/Sorghum, Soybeans, Wheat/Alfalfa";

    private const string LivestockList =
        "Milk, Dairy Cows (all eligible for organic slaughter), "
        + "Dairy Replacements (all eligible for organic slaughter)";

    private const string CarryoverProse =
        "Carryover Crops of: 2024 Soybeans - 4000 bushels and 2024 Corn - 5000 bushels";

    [Fact]
    public void SplitsACropListIntoIndividualCrops()
    {
        // The desk's call: "Oats/Alfalfa" means the producer may sell both, so a trader searching
        // for oats has to find them.
        var crops = OrganicCertifiedCrops.Split(CropList);

        Assert.Contains("Oats", crops);
        Assert.Contains("Alfalfa", crops);
        Assert.Contains("Rye", crops);
        Assert.Contains("Sorghum", crops);
        Assert.Contains("Wheat", crops);
        Assert.Contains("Soybeans", crops);
    }

    [Fact]
    public void CollapsesDuplicatesProducedBySplitting()
    {
        // Alfalfa appears three times in that string — alone, and as half of two pairings. One chip.
        var crops = OrganicCertifiedCrops.Split(CropList);

        Assert.Single(crops, c => string.Equals(c, "Alfalfa", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void KeepsSourceOrderAndFirstSeenCasing()
    {
        var crops = OrganicCertifiedCrops.Split(CropList);

        Assert.Equal("Alfalfa", crops[0]);
        Assert.Equal("Corn", crops[1]);
        Assert.Equal("CRP", crops[2]);
    }

    [Fact]
    public void NeverSplitsInsideBrackets()
    {
        // "Dairy Cows (all eligible for organic slaughter)" is one entry. Without the bracket rule
        // the comma inside would cut it in half and produce a chip reading "all eligible for
        // organic slaughter)".
        var crops = OrganicCertifiedCrops.Split(LivestockList);

        Assert.Equal(3, crops.Count);
        Assert.Contains("Milk", crops);
        Assert.Contains("Dairy Cows (all eligible for organic slaughter)", crops);
        Assert.DoesNotContain(crops, c => c.StartsWith("all eligible"));
    }

    [Fact]
    public void ProseIsSplitIntoFragments_KnownLimitation()
    {
        // ⚠️ This documents a LIMITATION, not desired behaviour. Some certifiers write prose into
        // this field, and splitting it on punctuation produces fragments that are not crops --
        // "4000 bushels" is a quantity. The hyphen is what does the damage here.
        //
        // Accepted deliberately: the alternative is not splitting at all, which would hide "Oats"
        // from a trader searching for it on every free-text producer. An odd-looking chip is a
        // better failure than a missing crop.
        //
        // If the desk finds this too noisy, drop '-' from the separator list first -- that alone
        // fixes this string while leaving the real crop lists intact.
        var crops = OrganicCertifiedCrops.Split(CarryoverProse);

        Assert.Contains(crops, c => c.Contains("4000 bushels"));
        Assert.Contains(crops, c => c.Contains("Soybeans"));
    }

    [Fact]
    public void ACataloguedNameIsUsedAsIsAndNeverSplit()
    {
        // Catalogued names come from USDA's own catalogue and are already single crops. Splitting
        // them would break legitimate names containing punctuation.
        var crops = OrganicCertifiedCrops.ForItem("Field/Forageable Mix", otherItems: null);

        Assert.Equal(["Field/Forageable Mix"], crops);
    }

    [Fact]
    public void FallsBackToFreeTextOnlyWhenThereIsNoCataloguedName()
    {
        Assert.Equal(["Soybeans"], OrganicCertifiedCrops.ForItem("Soybeans", "ignored, text"));
        Assert.Equal(["Corn", "Oats"], OrganicCertifiedCrops.ForItem(null, "Corn, Oats"));
        Assert.Equal(["Corn", "Oats"], OrganicCertifiedCrops.ForItem("   ", "Corn, Oats"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(",,,")]
    [InlineData(" - / & ")]
    public void NothingUsableYieldsAnEmptyList(string? input)
    {
        // Separators with no content between them must not produce blank chips.
        Assert.Empty(OrganicCertifiedCrops.Split(input));
    }
    [Fact]
    public void ExactOutputForReview()
    {
        Assert.Equal(
            ["Alfalfa", "Corn", "CRP", "Oats", "Pasture", "Rye", "Sorghum", "Soybeans", "Wheat"],
            OrganicCertifiedCrops.Split(CropList));

        Assert.Equal(
            ["Milk", "Dairy Cows (all eligible for organic slaughter)",
             "Dairy Replacements (all eligible for organic slaughter)"],
            OrganicCertifiedCrops.Split(LivestockList));

        Assert.Equal(
            ["Carryover Crops of: 2024 Soybeans", "4000 bushels and 2024 Corn", "5000 bushels"],
            OrganicCertifiedCrops.Split(CarryoverProse));
    }
}
