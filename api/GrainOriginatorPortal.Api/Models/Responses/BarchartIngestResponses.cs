namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Result of loading a BarChart instrument (catalog) payload.</summary>
public record BarchartInstrumentLoadResponse
{
    /// <summary>Catalog rows inserted or updated.</summary>
    public int RowsLoaded { get; init; }
}

/// <summary>Result of loading a BarChart quote payload.</summary>
public record BarchartQuoteLoadResponse
{
    /// <summary>Current-price rows written.</summary>
    public int QuotesUpserted { get; init; }

    /// <summary>
    /// Quotes skipped because their symbol isn't in the catalog. A non-zero value that persists means
    /// the catalog needs a discovery load.
    /// </summary>
    public int UnknownSymbolCount { get; init; }

    /// <summary>Business date the day's history rows were written under.</summary>
    public DateOnly SnapshotDate { get; init; }
}

/// <summary>A batch of symbols to request quotes for.</summary>
public record BarchartQuoteBatchResponse
{
    public int BatchNumber { get; init; }
    public int SymbolCount { get; init; }
    public string SymbolsCsv { get; init; } = string.Empty;
}

/// <summary>Result of publishing feed prices onto the Bid Sheet.</summary>
public record BarchartApplyBidsResponse
{
    /// <summary>Bid cells written or pruned.</summary>
    public int RowsAffected { get; init; }
}

/// <summary>Result of deactivating catalog entries the vendor has stopped publishing.</summary>
public record BarchartDeactivateResponse
{
    public int RowsDeactivated { get; init; }
}

/// <summary>Result of trimming the audit and price-history tables to their retention windows.</summary>
public record BarchartPurgeResponse
{
    /// <summary>Rows removed across the audit and price-history tables.</summary>
    public int RowsRemoved { get; init; }
}

/// <summary>Month-to-date ingest usage against the vendor's monthly call cap.</summary>
public record BarchartBudgetResponse
{
    public int MonthToDateCalls { get; init; }
    public int RemainingCalls { get; init; }

    /// <summary>True once usage reaches 80% of the cap — stop non-essential loads.</summary>
    public bool AbortRecommended { get; init; }
}
