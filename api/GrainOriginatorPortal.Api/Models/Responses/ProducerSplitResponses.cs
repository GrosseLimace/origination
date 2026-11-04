namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>A producer's CTRM splits, for picking field-plan fields.</summary>
public record ProducerSplitsResponse
{
    /// <summary>"sample" until the CTRM splits query is confirmed, then "ctrm".</summary>
    public required string Source { get; init; }
    public required IReadOnlyList<ProducerSplitResponse> Splits { get; init; }
}

/// <summary>One CTRM split (combined customer ID), e.g. TATOB43 "JARBOE WEST" at 100%.</summary>
public record ProducerSplitResponse
{
    public required string SplitId { get; init; }
    public required string PrimaryCustomerId { get; init; }
    /// <summary>CTRM's combined customer name, e.g. "T-A TOBIN - JARBOE WEST".</summary>
    public required string Name { get; init; }
    /// <summary>The field's name, e.g. "JARBOE WEST".</summary>
    public required string FieldName { get; init; }
    public required decimal SplitPercent { get; init; }
    /// <summary>yyyy-MM-dd.</summary>
    public required string EffectiveDate { get; init; }
    public required bool Expired { get; init; }
    /// <summary>"Field" or "Bin".</summary>
    public required string Kind { get; init; }
}
