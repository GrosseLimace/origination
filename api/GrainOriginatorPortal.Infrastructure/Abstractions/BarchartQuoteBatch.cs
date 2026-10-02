namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// A ready-made batch of instrument symbols for the caller to request quotes for. Handing these out
/// keeps batching logic in one place and means the ingestion pipeline never has to track which
/// symbols exist.
/// </summary>
public record BarchartQuoteBatch
{
    /// <summary>1-based batch number.</summary>
    public int BatchNumber { get; init; }

    /// <summary>How many symbols this batch contains.</summary>
    public int SymbolCount { get; init; }

    /// <summary>Comma-separated symbols, ready to pass to the vendor's quote endpoint.</summary>
    public string SymbolsCsv { get; init; } = string.Empty;
}
