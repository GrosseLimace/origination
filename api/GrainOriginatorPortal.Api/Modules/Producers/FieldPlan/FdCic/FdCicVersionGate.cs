namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.FdCic;

/// <summary>
/// Input checks against a pack's own option lists, so a label that changes between USDA versions is
/// caught as invalid input rather than scored as "no data". Mirrors the workbook's input validation,
/// plus expected yield above 0 (the workbook divides by zero otherwise).
/// </summary>
public static class FdCicInputRules
{
    public const int MaxManureEntries = 3;

    /// <summary>Field → messages. Empty when the input can be scored.</summary>
    public static Dictionary<string, string[]> Validate(FdCicPack pack, FdCicInput input)
    {
        var errors = new Dictionary<string, string[]>();
        void Fail(string field, string message) => errors[field] = [message];
        bool OneOf(string[] options, string value) => options.Contains(value, StringComparer.OrdinalIgnoreCase);

        if (!OneOf(pack.Options.Crops, input.Crop))
            Fail("crop", $"{pack.Label} scores {string.Join(", ", pack.Options.Crops)}.");
        if (!pack.HasCounty(input.State, input.County))
            Fail("county", $"{input.County} County, {input.State} is not in {pack.Label}'s county list.");
        if (!pack.Options.CoverCrops.Contains(input.CoverCrop, StringComparer.Ordinal))
            Fail("coverCrop", $"Cover crop must be one of: {string.Join(", ", pack.Options.CoverCrops)}.");
        if (!pack.Options.Tillage.Contains(input.Tillage, StringComparer.Ordinal))
            Fail("tillage", $"Tillage must be one of: {string.Join(", ", pack.Options.Tillage)}.");
        if (!(input.ExpectedYield > 0))
            Fail("expectedYield", "Expected yield must be greater than 0.");
        if (input.ActualYield is < 0)
            Fail("actualYield", "Actual yield can't be negative.");
        if (input.SyntheticN < 0)
            Fail("syntheticN", "Synthetic N can't be negative.");
        if (input.NiFraction is < 0 or > 1)
            Fail("niFraction", "The inhibitor share must be between 0 and 1.");
        if (input.Manure.Count > MaxManureEntries)
            Fail("manure", $"Enter at most {MaxManureEntries} manure applications.");
        if (input.Manure.Any(m => m.Amount < 0 || m.NContent < 0))
            Fail("manure", "Manure amounts and N content can't be negative.");
        return errors;
    }
}

/// <summary>
/// Decides whether a pack may be used: a method must match its formulas, its test cases must have been
/// confirmed in Excel against the same workbook the pack came from, and the method must reproduce every
/// case. Scored cases must match each output to a relative 1e-9; Excel errors must come back unscorable.
/// </summary>
public static class FdCicVersionGate
{
    public const double RelativeTolerance = 1e-9;

    /// <summary>The method to use, or the reason the version can't be switched on.</summary>
    public static (IFdCicMethod? Method, string? Problem) Check(FdCicPack pack, IEnumerable<IFdCicMethod> methods)
    {
        var method = methods.FirstOrDefault(m => m.FormulaFingerprint == pack.Manifest.FormulaFingerprint);
        if (method is null)
            return (null, $"No calculator matches {pack.Label}'s formulas (fingerprint {pack.Manifest.FormulaFingerprint[..12]}…). " +
                          "USDA changed the method; see the pack's CHANGES.md.");

        var confirmed = pack.Golden.ConfirmedInExcel;
        if (confirmed is null || pack.Golden.Cases.Length == 0)
            return (null, $"{pack.Label} has no Excel-confirmed test cases. Run tools/fdcic-extract/golden.mjs.");
        if (!string.Equals(confirmed.WorkbookSha256, pack.Manifest.Source.Sha256, StringComparison.OrdinalIgnoreCase))
            return (null, $"{pack.Label}'s test cases were confirmed against a different workbook than the pack was extracted from.");

        var failures = pack.Golden.Cases.Select(c => Mismatch(pack, method, c)).OfType<string>().ToList();
        return failures.Count == 0
            ? (method, null)
            : (null, $"{failures.Count} of {pack.Golden.Cases.Length} {pack.Label} test case(s) don't match Excel. First: {failures[0]}");
    }

    /// <summary>Null when the method reproduces Excel's result for the case; otherwise what differs.</summary>
    public static string? Mismatch(FdCicPack pack, IFdCicMethod method, FdCicGoldenCase testCase)
    {
        var expected = testCase.Expected;
        if (expected is null) return $"\"{testCase.Name}\" has no Excel result.";

        var errors = FdCicInputRules.Validate(pack, testCase.ToInput());
        if (errors.Count > 0) return $"\"{testCase.Name}\" input is invalid: {string.Join(" ", errors.Values.SelectMany(v => v))}";

        var result = method.Calculate(pack, testCase.ToInput());
        if (expected.Error is not null)
            return result.Scorable ? $"\"{testCase.Name}\": Excel gives {expected.Error} but the calculator scored {result.Ci}." : null;
        if (!result.Scorable)
            return $"\"{testCase.Name}\": Excel scores {expected.Ci} but the calculator says: {result.UnscorableReason}";

        var c = result.Components!;
        (string Output, double? Excel, double? Calculated)[] outputs =
        [
            ("yieldForCi", expected.YieldForCi, result.YieldForCi),
            ("nFertilizer", expected.NFertilizer, c.NFertilizer),
            ("soilCarbon", expected.SoilCarbon, c.SoilCarbon),
            ("directN2o", expected.DirectN2o, c.DirectN2o),
            ("indirectN2o", expected.IndirectN2o, c.IndirectN2o),
            ("onFarmEnergy", expected.OnFarmEnergy, c.OnFarmEnergy),
            ("otherChemicals", expected.OtherChemicals, c.OtherChemicals),
            ("ureaLime", expected.UreaLime, c.UreaLime),
            ("ci", expected.Ci, result.Ci),
            ("nationalAverage", expected.NationalAverage, result.NationalAverage),
            ("changeFraction", expected.ChangeFraction, result.ChangeFraction),
        ];
        foreach (var (output, excel, calculated) in outputs)
        {
            if (excel is null || calculated is null)
                return $"\"{testCase.Name}\" {output}: Excel {excel?.ToString() ?? "(missing)"}, calculator {calculated?.ToString() ?? "(missing)"}.";
            if (Math.Abs(calculated.Value - excel.Value) > RelativeTolerance * Math.Max(1, Math.Abs(excel.Value)))
                return $"\"{testCase.Name}\" {output}: Excel {excel.Value:R}, calculator {calculated.Value:R}.";
        }
        return null;
    }
}
