namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>A USDA FD-CIC version the API knows, and whether it passed its Excel-confirmed test cases.</summary>
public record FdCicVersionResponse
{
    public required string Version { get; init; }
    public required string Label { get; init; }
    /// <summary>Crop years configured to use this version.</summary>
    public required IReadOnlyList<int> Years { get; init; }
    public required bool Available { get; init; }
    /// <summary>Why the version is switched off; null when available.</summary>
    public string? Problem { get; init; }
    public string? SourceFile { get; init; }
    public string? SourceSha256 { get; init; }
    public string? WorkbookModified { get; init; }
    public string? FormulaFingerprint { get; init; }
    public string? ConfirmedInExcelOn { get; init; }
}

/// <summary>The input choices for a year's FD-CIC version, using the workbook's exact labels. Field
/// locations come from <c>GET api/fd-cic/states</c> and <c>/counties</c>.</summary>
public record FdCicOptionsResponse
{
    public required string Version { get; init; }
    public required string Label { get; init; }
    public required IReadOnlyList<string> Crops { get; init; }
    public required IReadOnlyList<string> CoverCrops { get; init; }
    public required IReadOnlyList<string> Tillage { get; init; }
    public required IReadOnlyList<FdCicManureTypeResponse> ManureTypes { get; init; }
    public required int MaxManureEntries { get; init; }
}

public record FdCicManureTypeResponse
{
    public required string Label { get; init; }
    public required string Unit { get; init; }
    /// <summary>USDA's "likely maximum" N content per unit; the workbook warns above it.</summary>
    public double? LikelyMaxNPerUnit { get; init; }
}

/// <summary>
/// A field's FD-CIC score with the version that produced it. Store <see cref="Label"/>,
/// <see cref="SourceSha256"/> and <see cref="FormulaFingerprint"/> with any score that is kept.
/// </summary>
public record FdCicScoreResponse
{
    public required string Version { get; init; }
    public required string Label { get; init; }
    public required string SourceSha256 { get; init; }
    public required string FormulaFingerprint { get; init; }
    /// <summary>True when no actual yield was given and the expected yield stood in for it.</summary>
    public required bool Projected { get; init; }
    public required bool Scorable { get; init; }
    public string? UnscorableReason { get; init; }
    public string? Mlra { get; init; }
    public required double YieldForCi { get; init; }
    public FdCicComponentsResponse? Components { get; init; }
    /// <summary>
    /// Not a USDA output: each component split into the part the field's inputs change and the part the
    /// method fixes (national figures), with the inputs that drive it. Empty when unscorable.
    /// </summary>
    public required IReadOnlyList<FdCicComponentPartResponse> Breakdown { get; init; }
    /// <summary>g CO2e/bu; null when unscorable.</summary>
    public double? Ci { get; init; }
    public required double NationalAverage { get; init; }
    /// <summary>(CI − national) ÷ national, e.g. -0.25 for 25% below.</summary>
    public double? ChangeFraction { get; init; }
    /// <summary>
    /// Not a USDA output: how much each of the field's choices moves its CI, against the workbook default
    /// (g CO2e/bu, negative = lowers it), most helpful first. Empty when unscorable.
    /// </summary>
    public required IReadOnlyList<FdCicEffectResponse> Effects { get; init; }
    public required string Unit { get; init; }
}

public record FdCicEffectResponse
{
    public required string Label { get; init; }
    public required double Delta { get; init; }
    /// <summary>Where the change lands: each component it moves by 1 g CO2e/bu or more, largest first.</summary>
    public required IReadOnlyList<FdCicEffectComponentResponse> Components { get; init; }
}

public record FdCicEffectComponentResponse
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    public required double Delta { get; init; }
}

public record FdCicComponentPartResponse
{
    /// <summary>e.g. "soilCarbon", as in <see cref="FdCicComponentsResponse"/>.</summary>
    public required string Key { get; init; }
    public required string Label { get; init; }
    public required double Total { get; init; }
    /// <summary>The part no input changes; <see cref="Total"/> − <see cref="Fixed"/> is what the inputs drive.</summary>
    public required double Fixed { get; init; }
    public string? FixedLabel { get; init; }
    public required IReadOnlyList<string> Drivers { get; init; }
}

public record FdCicComponentsResponse
{
    public required double NFertilizer { get; init; }
    public required double SoilCarbon { get; init; }
    public required double DirectN2o { get; init; }
    public required double IndirectN2o { get; init; }
    public required double OnFarmEnergy { get; init; }
    public required double OtherChemicals { get; init; }
    public required double UreaLime { get; init; }
}
