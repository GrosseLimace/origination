namespace GrainOriginatorPortal.Api.Services.FdCic;

/// <summary>One management unit's FD-CIC inputs, using the workbook's own labels (see the pack's options).</summary>
/// <param name="ActualYield">bu/ac. Null for a projected score before harvest; the expected yield is used.</param>
/// <param name="ExpectedYield">bu/ac: crop-insurance or USDA county benchmark yield. Must be above 0.</param>
/// <param name="SyntheticN">Total synthetic N applied, lb N/ac.</param>
/// <param name="NiFraction">Share of synthetic N with a nitrification inhibitor, 0 to 1.</param>
public sealed record FdCicInput(
    string Crop,
    string State,
    string County,
    double? ActualYield,
    double ExpectedYield,
    double SyntheticN,
    double NiFraction,
    string CoverCrop,
    string Tillage,
    IReadOnlyList<FdCicManure> Manure);

/// <param name="Amount">tons/ac (solid) or 1,000 gal/ac (liquid).</param>
/// <param name="NContent">lb N per ton or per 1,000 gal.</param>
public sealed record FdCicManure(double Amount, double NContent);

/// <summary>The score's parts, g CO2e/bu, named after the workbook's output rows.</summary>
public sealed record FdCicComponents(
    double NFertilizer,
    double SoilCarbon,
    double DirectN2o,
    double IndirectN2o,
    double OnFarmEnergy,
    double OtherChemicals,
    double UreaLime);

/// <summary>
/// One CI component split into what the form's inputs change and what the method fixes. Not a USDA output:
/// it explains the formulas, so it lives with the method that implements them.
/// </summary>
/// <param name="Key">The component's name in <see cref="FdCicComponents"/>, camel-cased (e.g. "soilCarbon").</param>
/// <param name="Total">The component's value, g CO2e/bu; the same number as in <see cref="FdCicComponents"/>.</param>
/// <param name="Fixed">The part no input changes (a national figure or crop constant); 0 when none.</param>
/// <param name="FixedLabel">What the fixed part is, e.g. "Lime"; null when <paramref name="Fixed"/> is 0 by design.</param>
/// <param name="Drivers">The form inputs that change the rest, in the form's words; empty when nothing does.</param>
public sealed record FdCicComponentPart(string Key, string Label, double Total, double Fixed, string? FixedLabel, IReadOnlyList<string> Drivers);

/// <summary>
/// A calculated score, or the reason USDA's tables can't score this crop and place (where Excel shows
/// #N/A or #VALUE!). <see cref="Ci"/> and <see cref="Components"/> are null when unscorable.
/// </summary>
public sealed record FdCicResult(
    string? Mlra,
    double YieldForCi,
    FdCicComponents? Components,
    double? Ci,
    double NationalAverage,
    double? ChangeFraction,
    string? UnscorableReason)
{
    public bool Scorable => Ci.HasValue;
}

/// <summary>
/// The FD-CIC calculation steps for workbooks with a given set of formulas. Packs carry the numbers;
/// a method carries the arithmetic. A pack is only usable with the method whose
/// <see cref="FormulaFingerprint"/> matches its manifest, so a USDA release that changes a formula
/// needs a new method (alongside this one) rather than silently running the old arithmetic.
/// </summary>
public interface IFdCicMethod
{
    string FormulaFingerprint { get; }

    /// <summary>Scores valid input (see <see cref="FdCicInputRules"/>) against a pack's tables.</summary>
    FdCicResult Calculate(FdCicPack pack, FdCicInput input);

    /// <summary>
    /// Splits a score's components into the part the field's inputs change and the part the method fixes,
    /// with the inputs that drive each, so the screen never suggests an input changes what it can't.
    /// </summary>
    IReadOnlyList<FdCicComponentPart> Breakdown(FdCicPack pack, FdCicInput input, FdCicComponents components);
}

/// <summary>
/// The arithmetic of USDA FD-CIC v1.2's Crop Inputs sheet, column C, exactly as documented in
/// docs/45z/fd-cic-v1.2-method.md (§2.14). Cell references are noted on each step. Every value is a
/// double with no intermediate rounding, the same as Excel.
/// </summary>
public sealed class FdCicMethodV1 : IFdCicMethod
{
    /// <summary>The v1.2 workbook's formula fingerprint (pack manifest <c>formulaFingerprint</c>).</summary>
    public const string Fingerprint = "a2ccea4bf326bc42de747ddea8fe1a45d8879d18d364aa8bb8ba97ef105328d7";

    public string FormulaFingerprint => Fingerprint;

    public FdCicResult Calculate(FdCicPack pack, FdCicInput input)
    {
        var k = pack.Constants;
        var crop = k.Crop(input.Crop) ?? throw new ArgumentException($"Unknown crop {input.Crop}.", nameof(input));
        var national = crop.National;

        // C16: actual yield clamped to 0.8-1.2 × expected yield.
        double actual = input.ActualYield ?? input.ExpectedYield;
        double low = k.YieldLowerBound * input.ExpectedYield, high = k.YieldUpperBound * input.ExpectedYield;
        double yieldForCi = actual < low ? low : actual > high ? high : actual;

        string? mlra = pack.MlraFor(input.State, input.County);
        if (mlra is null)
            return Unscorable(null, yieldForCi, national, $"{input.County} County, {input.State} has no USDA MLRA in {pack.Label}.");

        var (iefDirect, iefIndirect) = pack.Ief.For(input.Crop, mlra);
        double? Csa(string block) => pack.Csa.Value(block, input.Crop, mlra, input.CoverCrop, input.Tillage, k.FixedPractice);
        double? Ni(string block) => pack.NiImpact.Value(block, input.Crop, mlra, input.CoverCrop, input.Tillage, k.FixedPractice);
        double? soc = Csa("socGPerBu"), csaDirect = Csa("directN2oChange"), csaIndirect = Csa("indirectN2oChange"), csaFuel = Csa("fuelChange");
        double? niDirect = Ni("directN2oChange"), niIndirect = Ni("indirectN2oChange");

        string place = $"{input.County} County, {input.State} (MLRA {mlra})";
        string cropName = input.Crop.ToLowerInvariant();
        if (iefDirect is null || iefIndirect is null)
            return Unscorable(mlra, yieldForCi, national, $"{pack.Label} has no {cropName} data for {place}.");
        if (soc is null || csaDirect is null || csaIndirect is null || csaFuel is null || niDirect is null || niIndirect is null)
            return Unscorable(mlra, yieldForCi, national,
                $"{pack.Label} has no {cropName} data for \"{input.CoverCrop}\" with \"{input.Tillage}\" in {place}.");

        double nui = input.SyntheticN / yieldForCi;                                   // C20
        double nueAdjustment = crop.DefaultNui / crop.NuiThreshold;                   // C23 = C21 / C27
        double manureNGramsPerAcre = input.Manure.Sum(m => m.Amount * m.NContent) * k.GPerLb;   // C45
        double n2o = k.GwpN2o * k.N2oNToN2o;

        double nFertilizer = national.NFertilizer * (nui / crop.NuiThreshold);        // C70
        double soilCarbon = -soc.Value;                                               // C72

        // C79 / C80: synthetic N (with inhibitor), crop residue N and manure N, times the practice change.
        double N2o(double iefPercent, double niChange, double practiceChange) =>
            (nueAdjustment * (input.SyntheticN * k.GPerLb / yieldForCi) * (iefPercent / 100) * n2o * (1 + input.NiFraction * niChange)
             + crop.ResidueNGPerBu * (iefPercent / 100) * n2o
             + nueAdjustment * (manureNGramsPerAcre / yieldForCi) * (iefPercent / 100) * n2o)
            * (1 + practiceChange);
        double directN2o = N2o(iefDirect.Value, niDirect.Value, csaDirect.Value) + crop.NFixationGN2oPerBu * k.GwpN2o;
        double indirectN2o = N2o(iefIndirect.Value, niIndirect.Value, csaIndirect.Value);

        double onFarmEnergy = national.OnFarmFuel * (1 + csaFuel.Value) + national.OnFarmOther;   // C82
        double otherChemicals = national.OtherChemicals;                                          // C83
        double ureaLime = national.Urea * (nui / crop.NuiThreshold) + national.Lime;              // C84

        // C68 = SUM(C70, C72, C82:C83, C84) + C81
        double ci = nFertilizer + soilCarbon + onFarmEnergy + otherChemicals + ureaLime + (directN2o + indirectN2o);
        return new FdCicResult(
            mlra,
            yieldForCi,
            new FdCicComponents(nFertilizer, soilCarbon, directN2o, indirectN2o, onFarmEnergy, otherChemicals, ureaLime),
            ci,
            national.Total,
            (ci - national.Total) / national.Total,                                   // C98
            null);
    }

    // What drives each component in v1.2, read off Calculate above (docs/45z/fd-cic-v1.2-method.md, "What the
    // inputs change"). A new method for a new USDA version must review these alongside its formulas.
    private const string NRate = "N rate", Inhibitor = "Nitrification inhibitor", Manure = "Manure",
        Tillage = "Tillage", Cover = "Cover crop", Yield = "Yield", County = "County";
    private static readonly string[] N2oDrivers = [NRate, Inhibitor, Manure, Tillage, Cover, Yield, County];

    public IReadOnlyList<FdCicComponentPart> Breakdown(FdCicPack pack, FdCicInput input, FdCicComponents c)
    {
        var k = pack.Constants;
        var crop = k.Crop(input.Crop) ?? throw new ArgumentException($"Unknown crop {input.Crop}.", nameof(input));
        var national = crop.National;
        double nFixation = crop.NFixationGN2oPerBu * k.GwpN2o;                        // in C79 (direct N2O), soybeans only
        return
        [
            new("nFertilizer", "Nitrogen fertilizer", c.NFertilizer, 0, null, [NRate, Yield]),             // C70
            new("directN2o", "Field N₂O, direct", c.DirectN2o, nFixation, nFixation != 0 ? "Soybean N fixation" : null, N2oDrivers), // C79
            new("indirectN2o", "Field N₂O, indirect", c.IndirectN2o, 0, null, N2oDrivers),                // C80
            new("soilCarbon", "Soil carbon (credit)", c.SoilCarbon, 0, null, [Tillage, Cover, County]),   // C72
            new("onFarmEnergy", "On-farm energy", c.OnFarmEnergy, national.OnFarmOther, "Other on-farm energy", [Tillage, Cover]), // C82: fuel × practice + other
            new("otherChemicals", "Other chemicals", c.OtherChemicals, c.OtherChemicals, "Other chemicals", []), // C83: national
            new("ureaLime", "Urea & lime", c.UreaLime, national.Lime, "Lime", [NRate, Yield]),            // C84: urea × NUI + lime
        ];
    }

    private static FdCicResult Unscorable(string? mlra, double yieldForCi, FdCicNationalAverage national, string reason) =>
        new(mlra, yieldForCi, null, null, national.Total, null, reason);
}
