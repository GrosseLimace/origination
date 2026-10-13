namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// Audit endpoint names that stand in one-for-one for a real BarChart API call, and so meter usage
/// against the vendor's monthly cap. The pipeline posts to these straight after calling the vendor.
///
/// Everything else we audit (<c>quote-batches</c>, <c>apply-bids</c>, <c>deactivate-instruments</c>,
/// <c>purge-history</c>) is internal and consumes no vendor quota, so it is recorded for traceability
/// but deliberately left out of the budget count.
/// </summary>
public static class VendorCallEndpoints
{
    public const string Instruments = "ingest/instruments";
    public const string Quotes = "ingest/quotes";
}
