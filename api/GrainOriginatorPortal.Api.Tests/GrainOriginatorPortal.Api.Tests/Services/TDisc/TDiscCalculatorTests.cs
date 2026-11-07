// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.TDisc;
using Microsoft.Extensions.Logging.Abstractions;

namespace GrainOriginatorPortal.Api.Tests.Services.TDisc;

/// <summary>
/// The USDA T-DISC calculator against its pack's Excel-confirmed test cases, plus the checks on the passes
/// and on the pack itself. A new pack (a new USDA version) is picked up automatically: its cases run here.
/// See docs/45z/README.md ("T-DISC").
/// </summary>
public class TDiscCalculatorTests
{
    private static readonly Lazy<TDiscPack> V111 = new(() => TDiscPack.LoadEmbedded("1.1.1"));

    public static IEnumerable<object[]> AllCases() =>
        TDiscPack.EmbeddedVersions().SelectMany(v => TDiscPack.LoadEmbedded(v).Golden.Cases.Select(c => new object[] { v, c.Name }));

    [Fact]
    public void TheV111PackIsEmbedded_AndPassesItsGate()
    {
        Assert.Contains("1.1.1", TDiscPack.EmbeddedVersions());
        Assert.Null(TDiscCalculator.GateProblem(V111.Value));
        Assert.Equal(V111.Value.Manifest.Source.Sha256, V111.Value.Golden.ConfirmedInExcel!.WorkbookSha256);
    }

    [Theory]
    [MemberData(nameof(AllCases))]
    public void Calculator_ReproducesExcel(string version, string caseName)
    {
        var pack = TDiscPack.LoadEmbedded(version);
        Assert.Null(TDiscCalculator.Mismatch(pack, pack.Golden.Cases.Single(c => c.Name == caseName)));
    }

    [Fact]
    public void Rate_SortsByDepth_SoTheOrderEnteredDoesntMatter()
    {
        TDiscPassInput[] deepFirst = [new("Field_Preparation", "PLOW, MOLDBOARD"), new("Field_Preparation", "HARROW, SPIKE TOOTH OR SPRING TOOTH")];

        var a = TDiscCalculator.Rate(V111.Value, deepFirst);
        var b = TDiscCalculator.Rate(V111.Value, [.. deepFirst.Reverse()]);

        Assert.Equal(a.Rating, b.Rating);
        // 0.32 × 3 cm, then 0.9 × (15 − 0.96) cm, over 30 cm.
        Assert.Equal((0.96 + 0.9 * (15 - 0.96)) / 30, a.Rating, 12);
        Assert.Equal("CT", a.Designation);
        Assert.Equal("HARROW, SPIKE TOOTH OR SPRING TOOTH", a.Passes[0].Implement);
    }

    [Theory]
    [InlineData(0.0, "NT")]
    [InlineData(0.075, "NT")]
    [InlineData(0.0751, "RT")]
    [InlineData(0.252, "RT")]
    [InlineData(0.2521, "CT")]
    [InlineData(1.0, "CT")]
    public void Designate_Uses7Cfr2100Limits(double rating, string expected) =>
        Assert.Equal(expected, TDiscCalculator.Designate(V111.Value, rating));

    [Fact]
    public void Problem_RefusesNoPasses_TooMany_AndAnImplementOutsideItsWindow()
    {
        var pack = V111.Value;

        Assert.NotNull(TDiscCalculator.Problem(pack, []));
        Assert.NotNull(TDiscCalculator.Problem(pack, Enumerable.Repeat(new TDiscPassInput("Harvest", "HARVEST, GRAIN"), 21).ToList()));
        Assert.Contains("harvest", TDiscCalculator.Problem(pack, [new("Harvest", "PLOW, CHISEL")]));
        Assert.Null(TDiscCalculator.Problem(pack, [new("Harvest", "HARVEST, GRAIN")]));
    }

    [Fact]
    public void Gate_RefusesAPackWhoseFormulasChanged()
    {
        var pack = V111.Value with { Manifest = V111.Value.Manifest with { FormulaFingerprint = new string('0', 64) } };

        Assert.Contains("formulas changed", TDiscCalculator.GateProblem(pack));
    }

    [Fact]
    public void Service_WithAFailingPack_IsSwitchedOff()
    {
        var pack = V111.Value with { Golden = V111.Value.Golden with { ConfirmedInExcel = null } };
        var service = new TDiscService(NullLogger<TDiscService>.Instance, () => pack);

        var ex = Assert.Throws<InfrastructureException>(() => service.Rate([new("Harvest", "HARVEST, GRAIN")]));
        Assert.Equal("TDISC_UNAVAILABLE", ex.ErrorCode);
    }

    [Fact]
    public void Service_Options_ListTheWindowsImplementsAndOperations()
    {
        var options = new TDiscService(NullLogger<TDiscService>.Instance).Options();

        Assert.Equal(["Field_Preparation", "Before_Planting", "Planting", "After_Planting", "Harvest"], options.Windows.Select(w => w.Key));
        Assert.Equal(93, options.Implements.Count);
        Assert.Contains(options.Operations, o => o.Name == "Residue, row cleaner" && o.Implements.SequenceEqual(["RESIDUE MGMT: TRASH WHEEL"]));
    }

    [Fact]
    public void Loading_AMissingVersion_Throws()
    {
        var ex = Assert.Throws<InvalidDataException>(() => TDiscPack.LoadEmbedded("9.9"));
        Assert.Contains("v9.9", ex.Message);
    }
}
