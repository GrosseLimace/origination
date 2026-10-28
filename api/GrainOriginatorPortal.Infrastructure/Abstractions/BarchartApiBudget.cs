namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// Month-to-date ingest-call usage against the vendor contract's monthly cap. The cap is shared by
/// every environment because there is one API key, so dev/QA testing consumes production allowance.
/// </summary>
public record BarchartApiBudget
{
    /// <summary>Ingest calls recorded so far this calendar month (UTC).</summary>
    public int MonthToDateCalls { get; init; }

    /// <summary>Calls remaining before the cap; negative if the cap has been passed.</summary>
    public int RemainingCalls { get; init; }

    /// <summary>True once usage reaches 80% of the cap — a signal to stop non-essential loads.</summary>
    public bool AbortRecommended { get; init; }
}
