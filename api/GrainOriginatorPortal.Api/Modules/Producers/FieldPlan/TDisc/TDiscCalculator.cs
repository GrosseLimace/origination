namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.TDisc;

/// <summary>A field pass: the tillage window it fell in and the T-DISC implement used.</summary>
public sealed record TDiscPassInput(string Window, string Implement);

/// <summary>A pass as rated: its implement's mixing efficiency and depth, and the tillage intensity it adds.</summary>
public sealed record TDiscRatedPass(string Window, string Implement, double MixingEfficiency, double DepthCm, double TillageIntensity);

/// <summary>A window's index (null when it had no passes) and its designation (NT, RT or CT).</summary>
public sealed record TDiscRatedWindow(string Key, string Label, double? Index, string? Designation);

/// <summary>The rating (the highest window index, 0-1) and its designation, with the worksheet behind it.</summary>
public sealed record TDiscResult(
    double Rating,
    string Designation,
    IReadOnlyList<TDiscRatedWindow> Windows,
    IReadOnlyList<TDiscRatedPass> Passes,
    string Version,
    string Label);

/// <summary>
/// USDA T-DISC v1.1.1's rating ('User Input' rows 8-29, one management unit), tied to that version's formula
/// fingerprint so a USDA change to the formulas switches T-DISC off until this is reviewed:
/// <list type="number">
/// <item>Every pass is sorted by depth, then mixing efficiency, both ascending (SORTBY).</item>
/// <item>Within each window, in that order, a pass adds ME × (depth − the window's earlier intensities).</item>
/// <item>A window's index is its total ÷ 30 cm; the rating is the highest index (MAX).</item>
/// <item>The designation is the smallest limit at or above the rating: NT ≤ 0.075, RT ≤ 0.252, CT ≤ 1.</item>
/// </list>
/// The client's fd-cic-tdisc.ts mirrors this for the screen; this one counts.
/// </summary>
public static class TDiscCalculator
{
    public const string FormulaFingerprint = "cb1d263f18b82ce49b7a0951a4432b4f1c355ba4fe1d2ce19b0fb0f557e190e4";

    public const double RelativeTolerance = 1e-9;

    /// <summary>What's wrong with the passes, or null when they can be rated.</summary>
    public static string? Problem(TDiscPack pack, IReadOnlyList<TDiscPassInput> passes)
    {
        if (passes.Count == 0) return "Add the field's passes from last harvest through this one.";
        if (passes.Count > pack.Rules.MaxPasses) return $"T-DISC takes at most {pack.Rules.MaxPasses} passes.";
        foreach (var pass in passes)
        {
            var window = pack.Windows.FirstOrDefault(w => w.Key == pass.Window);
            if (window is null) return $"\"{pass.Window}\" isn't a T-DISC tillage window.";
            if (!pack.Implements.ContainsKey(pass.Implement)) return $"\"{pass.Implement}\" isn't a T-DISC implement.";
            if (!window.Implements.Contains(pass.Implement, StringComparer.Ordinal))
                return $"T-DISC doesn't allow \"{pass.Implement}\" in {window.Label.ToLowerInvariant()}.";
        }
        return null;
    }

    /// <summary>Rates passes that <see cref="Problem"/> accepted.</summary>
    public static TDiscResult Rate(TDiscPack pack, IReadOnlyList<TDiscPassInput> passes)
    {
        // OrderBy is stable, as SORTBY is: passes with the same depth and efficiency keep their order.
        var sorted = passes
            .Select(p => (Pass: p, Implement: pack.Implements[p.Implement]))
            .OrderBy(p => p.Implement.DepthCm)
            .ThenBy(p => p.Implement.MixingEfficiency)
            .ToList();

        var totals = new Dictionary<string, double>(StringComparer.Ordinal);
        var rated = new List<TDiscRatedPass>(sorted.Count);
        foreach (var (pass, implement) in sorted)
        {
            var earlier = totals.GetValueOrDefault(pass.Window);
            var intensity = implement.MixingEfficiency * (implement.DepthCm - earlier);
            totals[pass.Window] = earlier + intensity;
            rated.Add(new TDiscRatedPass(pass.Window, implement.Name, implement.MixingEfficiency, implement.DepthCm, intensity));
        }

        var windows = pack.Windows.Select(w =>
        {
            double? index = totals.TryGetValue(w.Key, out var total) ? total / pack.Rules.IndexDepthCm : null;
            return new TDiscRatedWindow(w.Key, w.Label, index, index is { } i ? Designate(pack, i) : null);
        }).ToList();
        var rating = windows.Where(w => w.Index is not null).Select(w => w.Index!.Value).DefaultIfEmpty(0).Max();
        return new TDiscResult(rating, Designate(pack, rating), windows, rated, pack.Version, pack.Label);
    }

    /// <summary>NT, RT or CT: the smallest limit at or above the value.</summary>
    public static string Designate(TDiscPack pack, double value) =>
        pack.Rules.Designations.Where(d => d.Max >= value).MinBy(d => d.Max)?.Designation
            ?? throw new InvalidOperationException($"A T-DISC value of {value} is above every limit.");

    /// <summary>Why the pack can't be used, or null when it can: its formulas must be the ones this code
    /// implements, and every Excel-confirmed case must match to a relative 1e-9.</summary>
    public static string? GateProblem(TDiscPack pack)
    {
        if (pack.Manifest.FormulaFingerprint != FormulaFingerprint)
            return $"{pack.Label}'s formulas changed (fingerprint {pack.Manifest.FormulaFingerprint?[..Math.Min(12, pack.Manifest.FormulaFingerprint.Length)]}…); the T-DISC calculator needs review.";
        var confirmed = pack.Golden.ConfirmedInExcel;
        if (confirmed is null || pack.Golden.Cases.Length == 0)
            return $"{pack.Label} has no Excel-confirmed test cases. Run tools/tdisc-extract/golden.mjs.";
        if (!string.Equals(confirmed.WorkbookSha256, pack.Manifest.Source.Sha256, StringComparison.OrdinalIgnoreCase))
            return $"{pack.Label}'s test cases were confirmed against a different workbook than the pack was extracted from.";
        var failures = pack.Golden.Cases.Select(c => Mismatch(pack, c)).OfType<string>().ToList();
        return failures.Count == 0 ? null
            : $"{failures.Count} of {pack.Golden.Cases.Length} {pack.Label} test case(s) don't match Excel. First: {failures[0]}";
    }

    /// <summary>Null when the calculator reproduces Excel's result for the case; otherwise what differs.</summary>
    public static string? Mismatch(TDiscPack pack, TDiscGoldenCase testCase)
    {
        if (testCase.Expected is not { } expected) return $"\"{testCase.Name}\" has no Excel result.";
        if (Problem(pack, testCase.Passes) is { } problem) return $"\"{testCase.Name}\" passes are invalid: {problem}";

        var result = Rate(pack, testCase.Passes);
        static bool Same(double a, double b) => Math.Abs(a - b) <= RelativeTolerance * Math.Max(1, Math.Abs(b));
        if (!Same(result.Rating, expected.Rating)) return $"\"{testCase.Name}\" rating: Excel {expected.Rating:R}, calculator {result.Rating:R}.";
        if (result.Designation != expected.Designation) return $"\"{testCase.Name}\" designation: Excel {expected.Designation}, calculator {result.Designation}.";
        foreach (var window in result.Windows)
        {
            if (!expected.Windows.TryGetValue(window.Key, out var excel)) return $"\"{testCase.Name}\" has no Excel result for {window.Key}.";
            var indexMatches = (excel.Index, window.Index) switch
            {
                (null, null) => true,
                ({ } a, { } b) => Same(b, a),
                _ => false,
            };
            if (!indexMatches || excel.Designation != window.Designation)
                return $"\"{testCase.Name}\" {window.Key}: Excel {excel.Index?.ToString("R") ?? "blank"} {excel.Designation}, calculator {window.Index?.ToString("R") ?? "blank"} {window.Designation}.";
        }
        return null;
    }
}
