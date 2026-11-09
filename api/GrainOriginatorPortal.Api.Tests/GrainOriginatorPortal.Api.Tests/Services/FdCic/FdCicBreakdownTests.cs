using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.FdCic;

// Project namespaces

namespace GrainOriginatorPortal.Api.Tests.Services.FdCic;

/// <summary>
/// The component breakdown: which part of each CI component the field's inputs change, which part is a fixed
/// national figure, and which inputs drive it. Checked against the arithmetic itself, so the screen can never
/// suggest an input changes a component it doesn't.
/// </summary>
public class FdCicBreakdownTests
{
    private static readonly Lazy<FdCicPack> V12 = new(() => FdCicPack.LoadEmbedded("1.2"));
    private static readonly FdCicMethodV1 Method = new();

    public static IEnumerable<object[]> ScorableCases() =>
        V12.Value.Golden.Cases.Where(c => c.Expected?.Error is null).Select(c => new object[] { c.Name });

    private static (FdCicResult Result, IReadOnlyList<FdCicComponentPart> Parts) Score(FdCicInput input)
    {
        var result = Method.Calculate(V12.Value, input);
        return (result, result.Components is null ? [] : Method.Breakdown(V12.Value, input, result.Components));
    }

    /// <summary>One change per driver, from a case's own inputs.</summary>
    private static IEnumerable<(string Driver, FdCicInput Input)> Variants(FdCicInput input)
    {
        var options = V12.Value.Options;
        foreach (var tillage in options.Tillage.Where(t => t != input.Tillage)) yield return ("Tillage", input with { Tillage = tillage });
        foreach (var cover in options.CoverCrops.Where(c => c != input.CoverCrop)) yield return ("Cover crop", input with { CoverCrop = cover });
        yield return ("N rate", input with { SyntheticN = input.SyntheticN * 1.5 + 20 });
        yield return ("Nitrification inhibitor", input with { NiFraction = input.NiFraction > 0.5 ? 0 : 1 });
        yield return ("Manure", input with { Manure = [.. input.Manure, new FdCicManure(4, 10)] });
        yield return ("Yield", input with { ActualYield = input.ExpectedYield * 1.1 });
    }

    // -------------------------------------------------------------------------
    [Theory]
    [MemberData(nameof(ScorableCases))]
    public void Breakdown_MatchesTheComponents_AndAddsUpToTheCi(string caseName)
    {
        var input = V12.Value.Golden.Cases.Single(c => c.Name == caseName).ToInput();
        var (result, parts) = Score(input);
        var c = result.Components!;

        Assert.Equal(7, parts.Count);
        Assert.Equal(
            [c.NFertilizer, c.DirectN2o, c.IndirectN2o, c.SoilCarbon, c.OnFarmEnergy, c.OtherChemicals, c.UreaLime],
            parts.Select(p => p.Total));
        Assert.Equal(result.Ci!.Value, parts.Sum(p => p.Total - p.Fixed) + parts.Sum(p => p.Fixed), 9);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [MemberData(nameof(ScorableCases))]
    public void AnInputOnlyMovesTheComponentsThatListIt_AndNeverAFixedPart(string caseName)
    {
        var input = V12.Value.Golden.Cases.Single(c => c.Name == caseName).ToInput();
        var (_, before) = Score(input);

        foreach (var (driver, changed) in Variants(input))
        {
            var (result, after) = Score(changed);
            if (!result.Scorable) continue; // not every practice has USDA data in every MLRA
            foreach (var (b, a) in before.Zip(after))
            {
                Assert.Equal(b.Fixed, a.Fixed, 9);
                if (!b.Drivers.Contains(driver))
                    Assert.True(Math.Abs(b.Total - a.Total) < 1e-9, $"{caseName}: {driver} moved {b.Label}, which doesn't list it.");
            }
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void OtherChemicalsIsAllFixed_AndLimeAndOtherEnergyAreTheirFixedParts()
    {
        var (_, parts) = Score(V12.Value.Golden.Cases.First(c => c.Crop == "Corn" && c.Expected?.Error is null).ToInput());
        var national = V12.Value.Constants.Crop("Corn")!.National;

        var chemicals = parts.Single(p => p.Key == "otherChemicals");
        Assert.Empty(chemicals.Drivers);
        Assert.Equal(chemicals.Total, chemicals.Fixed);
        Assert.Equal(national.Lime, parts.Single(p => p.Key == "ureaLime").Fixed);
        Assert.Equal(national.OnFarmOther, parts.Single(p => p.Key == "onFarmEnergy").Fixed);
        Assert.All(parts.Where(p => p.Fixed == 0), p => Assert.Null(p.FixedLabel));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void SoybeanNFixationIsAFixedPartOfDirectN2o_OnlyForSoybeans()
    {
        var soy = V12.Value.Golden.Cases.First(c => c.Crop == "Soybean" && c.Expected?.Error is null).ToInput();
        var corn = V12.Value.Golden.Cases.First(c => c.Crop == "Corn" && c.Expected?.Error is null).ToInput();

        var soyDirect = Score(soy).Parts.Single(p => p.Key == "directN2o");
        Assert.True(soyDirect.Fixed > 0);
        Assert.Equal("Soybean N fixation", soyDirect.FixedLabel);
        Assert.Equal(0, Score(corn).Parts.Single(p => p.Key == "directN2o").Fixed);
    }
}
