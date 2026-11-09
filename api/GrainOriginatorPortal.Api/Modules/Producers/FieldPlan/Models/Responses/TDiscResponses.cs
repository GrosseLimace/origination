namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Models.Responses;

/// <summary>
/// What the review's T-DISC pass table is built from: the tillage windows and the implements each allows,
/// every implement's mixing efficiency and depth, and USDA's operation lookup. The rating itself is
/// worked out on the server when the field is confirmed.
/// </summary>
public record TDiscOptionsResponse
{
    public required string Version { get; init; }
    public required string Label { get; init; }
    public required int MaxPasses { get; init; }
    /// <summary>A window's index is its tillage intensity ÷ this depth (cm).</summary>
    public required double IndexDepthCm { get; init; }
    /// <summary>NT, RT and CT with the highest rating each covers.</summary>
    public required IReadOnlyList<TDiscLimitResponse> Designations { get; init; }
    public required IReadOnlyList<TDiscWindowResponse> Windows { get; init; }
    public required IReadOnlyList<TDiscImplementResponse> Implements { get; init; }
    public required IReadOnlyList<TDiscOperationResponse> Operations { get; init; }
}

public record TDiscLimitResponse
{
    public required double Max { get; init; }
    public required string Designation { get; init; }
}

public record TDiscWindowResponse
{
    /// <summary>The workbook's key, e.g. "Field_Preparation".</summary>
    public required string Key { get; init; }
    public required string Label { get; init; }
    public required IReadOnlyList<string> Implements { get; init; }
}

public record TDiscImplementResponse
{
    public required string Name { get; init; }
    public required double MixingEfficiency { get; init; }
    public required double DepthCm { get; init; }
}

public record TDiscOperationResponse
{
    public required string Name { get; init; }
    /// <summary>The T-DISC implements to enter for this operation, one pass each.</summary>
    public required IReadOnlyList<string> Implements { get; init; }
}
