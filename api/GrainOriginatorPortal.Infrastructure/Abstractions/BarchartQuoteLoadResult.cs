namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>Outcome of a BarChart quote load. Materialized directly from the load SQL's result row.</summary>
public record BarchartQuoteLoadResult
{
    /// <summary>Rows written to <c>dbo.BarchartCurrentQuote</c>.</summary>
    public int QuotesUpserted { get; init; }

    /// <summary>
    /// Quotes whose symbol isn't in the catalog, so they were skipped. Persistently non-zero means the
    /// instrument catalog is behind the quote feed and needs a discovery load.
    /// </summary>
    public int UnknownSymbolCount { get; init; }
}
