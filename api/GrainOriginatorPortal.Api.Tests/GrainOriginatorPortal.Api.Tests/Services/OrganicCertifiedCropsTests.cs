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

    // ── Leading conjunctions ─────────────────────────────────────────────────────────────────
    //
    // Found by the pipeline's first real run, not by us. LEHMMAD sent "Corn, Soybeans, and Wheat"
    // (Dev, 2026-10-12) and the desk would have seen a chip reading "and Wheat". Both samples above
    // use bare comma lists, which is why three rounds of testing never surfaced it — a reminder that
    // certifier free text is prose written by people, not a delimited field.

    [Fact]
    public void DropsTheLeadingAndFromAProseList()
    {
        Assert.Equal(
            ["Corn", "Soybeans", "Wheat"],
            OrganicCertifiedCrops.Split("Corn, Soybeans, and Wheat"));
    }

    [Fact]
    public void DropsTheLeadingOrToo()
    {
        Assert.Equal(
            ["Spring Wheat", "Winter Wheat"],
            OrganicCertifiedCrops.Split("Spring Wheat, or Winter Wheat"));
    }

    [Theory]
    [InlineData("Corn, AND Wheat")]
    [InlineData("Corn, And Wheat")]
    [InlineData("Corn,   and   Wheat")]
    public void TheConjunctionIsMatchedWhateverTheCasingOrSpacing(string input)
        => Assert.Equal(["Corn", "Wheat"], OrganicCertifiedCrops.Split(input));

    [Fact]
    public void DoesNotEatCropsThatMERELYSTARTWithAndOrOr()
    {
        // The whole reason the match requires a following space. Without it "Andean" becomes "ean"
        // and "Orchardgrass" becomes "chardgrass" — a mangled crop is worse than an ugly one.
        Assert.Equal(
            ["Andean Lupin", "Orchardgrass", "Oregano", "Orange"],
            OrganicCertifiedCrops.Split("Andean Lupin, Orchardgrass, Oregano, Orange"));
    }

    [Fact]
    public void LeavesAConjunctionInTheMIDDLEOfAnEntryAlone()
    {
        // Only a LEADING conjunction is punctuation. One inside the text is part of what the
        // certifier wrote, and the carryover sample above depends on this.
        Assert.Equal(
            ["Corn and Soybean Rotation"],
            OrganicCertifiedCrops.Split("Corn and Soybean Rotation"));
    }

    [Fact]
    public void DropsAPieceThatIsNothingButAConjunction()
    {
        // "Corn, and, Wheat" — sloppy punctuation produces a piece with no crop in it at all.
        Assert.Equal(["Corn", "Wheat"], OrganicCertifiedCrops.Split("Corn, and, Wheat"));
    }

    [Fact]
    public void HandlesAndSlashOr()
    {
        // "/" is already a separator, so this arrives as "and" + "or Wheat". The first collapses to
        // nothing and is dropped; the second loses its conjunction.
        Assert.Equal(["Corn", "Wheat"], OrganicCertifiedCrops.Split("Corn, and/or Wheat"));
    }

    [Fact]
    public void StillDeduplicatesAfterStripping()
    {
        // "and Wheat" and "Wheat" are the same crop once the conjunction is gone — they must not
        // both render.
        Assert.Equal(["Corn", "Wheat"], OrganicCertifiedCrops.Split("Corn, Wheat, and Wheat"));
    }

    // ── Commas inside numbers ────────────────────────────────────────────────────────────────
    //
    // The first full load (Dev, 2026-10-13, 1,138 producers) turned up nine certifiers writing
    // carryover quantities with a thousands separator. The comma was read as list punctuation, so
    // "1,050 bushels" rendered as a chip saying "1" and another saying "050 bushels". The strings
    // below are verbatim from that load.

    [Fact]
    public void DoesNotSplitAThousandsSeparator()
    {
        Assert.Equal(
            ["Carryover Crops of: 2025 Soybeans", "1,050 bushels"],
            OrganicCertifiedCrops.Split("Carryover Crops of: 2025 Soybeans - 1,050 bushels"));
    }

    [Fact]
    public void HandlesSeveralNumbersInOneString()
    {
        // Verbatim, and the worst of the nine: two thousands separators alongside a hyphen list.
        Assert.Equal(
            ["Carryover Crops of: 2025 Oats", "6500 bushels", "2025 Soybeans", "2000 bushels",
             "2025 Sunflowers", "200,000 lb"],
            OrganicCertifiedCrops.Split(
                "Carryover Crops of: 2025 Oats- 6500 bushels, 2025 Soybeans- 2000 bushels, "
                + "2025 Sunflowers- 200,000 lb"));
    }

    [Fact]
    public void StillSplitsACommaFollowedByASpace()
    {
        // The guard needs a digit on BOTH sides. A real list has a space after the comma, so the
        // common case must be unaffected — it is the one most easily broken by widening this.
        Assert.Equal(["Corn", "Soybeans", "Wheat"], OrganicCertifiedCrops.Split("Corn, Soybeans, Wheat"));
    }

    [Fact]
    public void StillSplitsAListOfYears()
    {
        // Digits either side, but a space after the comma, so it stays a list break. Pinned so the
        // guard is never widened to ignore spacing.
        Assert.Equal(["2024", "2019 Oats"], OrganicCertifiedCrops.Split("2024, 2019 Oats"));
    }

    [Fact]
    public void StillSplitsACommaWithNoSpaceBetweenTwoCrops()
    {
        // No space, but letters either side rather than digits — still list punctuation.
        Assert.Equal(["Corn", "Soybeans"], OrganicCertifiedCrops.Split("Corn,Soybeans"));
    }

    [Fact]
    public void ACommaAtTheVeryStartOrEndIsStillPunctuation()
    {
        // Guards the bounds check: index 0 and the last index have no neighbour to inspect and
        // must not throw.
        Assert.Equal(["Corn"], OrganicCertifiedCrops.Split(",Corn,"));
    }
}
