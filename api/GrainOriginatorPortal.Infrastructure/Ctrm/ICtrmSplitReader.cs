namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>What a split's ID stands for: a field, or a bin site that collects grain from several fields.</summary>
public enum CtrmSplitKind
{
    Field,
    Bin
}

/// <summary>
/// One row of CTRM's Customer Splits Inquiry: a "combined customer" (split) ID under a producer's primary ID,
/// e.g. TATOB43 "T-A TOBIN - JARBOE WEST". Producers use split IDs for fields, and tickets are delivered under
/// them, which is what ties a delivery to a field. A field-plan field is one split.
/// </summary>
/// <param name="SplitId">The split's CTRM customer ID, e.g. "TATOB43".</param>
/// <param name="PrimaryCustomerId">The producer's primary CTRM ID, e.g. "TATOBIN".</param>
/// <param name="Name">CTRM's combined customer name, e.g. "T-A TOBIN - JARBOE WEST".</param>
/// <param name="FieldName">The name without the producer prefix, e.g. "JARBOE WEST".</param>
/// <param name="SplitPercent">The producer's share, 0-100, e.g. 66.667.</param>
/// <param name="EffectiveDate">When the split took effect.</param>
/// <param name="Expired">Expired splits are kept in CTRM but take no new deliveries.</param>
/// <param name="Kind">A bin site isn't a field.</param>
public sealed record CtrmSplit(
    string SplitId,
    string PrimaryCustomerId,
    string Name,
    string FieldName,
    decimal SplitPercent,
    DateOnly EffectiveDate,
    bool Expired,
    CtrmSplitKind Kind);

/// <summary>Reads a producer's CTRM splits.</summary>
public interface ICtrmSplitReader
{
    /// <summary>"sample" or "ctrm", so the screen can say when the list isn't CTRM's.</summary>
    string Source { get; }

    /// <summary>Every split under the producer's primary code, including expired and bin-site ones.</summary>
    Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>> GetForProducerAsync(string producerCode, CancellationToken cancellationToken);
}
