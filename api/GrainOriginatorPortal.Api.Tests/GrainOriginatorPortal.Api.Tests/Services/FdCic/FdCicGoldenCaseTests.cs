using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.FdCic;

// Project namespaces

namespace GrainOriginatorPortal.Api.Tests.Services.FdCic;

/// <summary>
/// Every embedded USDA FD-CIC pack against its own Excel-confirmed test cases. A new pack (a new USDA
/// version) is picked up automatically: its cases run here, so the build fails until the calculator
/// reproduces Excel. See docs/45z/README.md.
/// </summary>
public class FdCicGoldenCaseTests
{
    private static readonly IFdCicMethod[] Methods = [new FdCicMethodV1()];

    private static readonly Dictionary<string, FdCicPack> Packs =
        FdCicPack.EmbeddedVersions().ToDictionary(v => v, v => FdCicPack.LoadEmbedded(v));

    public static IEnumerable<object[]> AllVersions() =>
        FdCicPack.EmbeddedVersions().Select(v => new object[] { v });

    public static IEnumerable<object[]> AllCases() =>
        FdCicPack.EmbeddedVersions().SelectMany(v => FdCicPack.LoadEmbedded(v).Golden.Cases.Select(c => new object[] { v, c.Name }));

    [Fact]
    public void TheV12PackIsEmbedded()
    {
        Assert.Contains("1.2", FdCicPack.EmbeddedVersions());
    }

    [Theory]
    [MemberData(nameof(AllCases))]
    public void Calculator_ReproducesExcel(string version, string caseName)
    {
        var pack = Packs[version];
        var testCase = pack.Golden.Cases.Single(c => c.Name == caseName);
        // The case runs on its own (not through the whole-version gate), so a failure names the cases that differ.
        var method = Methods.SingleOrDefault(m => m.FormulaFingerprint == pack.Manifest.FormulaFingerprint);
        Assert.True(method is not null, $"No calculator matches {pack.Label}'s formulas; see its CHANGES.md.");

        Assert.Null(FdCicVersionGate.Mismatch(pack, method, testCase));
    }

    [Theory]
    [MemberData(nameof(AllVersions))]
    public void EveryPack_PassesItsGate(string version)
    {
        var pack = Packs[version];

        var (method, problem) = FdCicVersionGate.Check(pack, Methods);

        Assert.Null(problem);
        Assert.NotNull(method);
        Assert.Equal(pack.Manifest.Source.Sha256, pack.Golden.ConfirmedInExcel!.WorkbookSha256);
    }

    [Fact]
    public void V12_ScoresTheDocumentedExample()
    {
        // docs/45z/fd-cic-v1.2-method.md test case 1: corn, Story County IA, no-till, inhibitor on half the N.
        var pack = Packs["1.2"];
        var input = new FdCicInput("Corn", "IA", "Story", 200, 190, 180, 0.5, "No cover crop", "No till", []);

        var result = new FdCicMethodV1().Calculate(pack, input);

        Assert.True(result.Scorable);
        Assert.Equal("103", result.Mlra);
        Assert.Equal(3070.75, result.Ci!.Value, 2);
        Assert.Equal(-0.4899, result.ChangeFraction!.Value, 4);
    }

    [Fact]
    public void Gate_RefusesAPackWhoseFormulasNoCalculatorKnows()
    {
        var pack = Packs["1.2"] with { Manifest = Packs["1.2"].Manifest with { FormulaFingerprint = new string('0', 64) } };

        var (method, problem) = FdCicVersionGate.Check(pack, Methods);

        Assert.Null(method);
        Assert.Contains("No calculator matches", problem);
    }

    [Fact]
    public void Gate_RefusesTestCasesConfirmedAgainstAnotherWorkbook()
    {
        var original = Packs["1.2"];
        var pack = original with
        {
            Golden = original.Golden with { ConfirmedInExcel = original.Golden.ConfirmedInExcel! with { WorkbookSha256 = new string('a', 64) } },
        };

        var (method, problem) = FdCicVersionGate.Check(pack, Methods);

        Assert.Null(method);
        Assert.Contains("different workbook", problem);
    }

    [Fact]
    public void Gate_RefusesAPackWhenAnyCaseDisagreesWithExcel()
    {
        var original = Packs["1.2"];
        var cases = original.Golden.Cases.ToArray();
        cases[0] = cases[0] with { Expected = cases[0].Expected! with { Ci = cases[0].Expected!.Ci + 0.01 } };
        var pack = original with { Golden = original.Golden with { Cases = cases } };

        var (method, problem) = FdCicVersionGate.Check(pack, Methods);

        Assert.Null(method);
        Assert.Contains("don't match Excel", problem);
        Assert.Contains(cases[0].Name, problem);
    }

    [Fact]
    public void Gate_RefusesAPackWithoutConfirmedCases()
    {
        var original = Packs["1.2"];
        var pack = original with { Golden = original.Golden with { ConfirmedInExcel = null } };

        var (method, problem) = FdCicVersionGate.Check(pack, Methods);

        Assert.Null(method);
        Assert.Contains("no Excel-confirmed test cases", problem);
    }

    [Fact]
    public void Loading_AMissingVersion_Throws()
    {
        var ex = Assert.Throws<InvalidDataException>(() => FdCicPack.LoadEmbedded("9.9"));
        Assert.Contains("v9.9", ex.Message);
    }
}
