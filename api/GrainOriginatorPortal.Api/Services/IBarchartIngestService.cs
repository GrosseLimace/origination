using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Receives BarChart payloads from the ingestion pipeline and files them, then publishes the results
/// onto the Bid Sheet. Validates payloads before they reach the database and records every call for
/// monthly vendor-usage tracking.
/// </summary>
public interface IBarchartIngestService
{
    /// <summary>Files a vendor instrument (catalog) payload.</summary>
    /// <param name="json">Raw vendor response body, forwarded unmodified.</param>
    Task<BarchartInstrumentLoadResponse> LoadInstrumentsAsync(string json, CancellationToken cancellationToken = default);

    /// <summary>Files a vendor quote payload against a business date (defaults to today, Central time).</summary>
    Task<BarchartQuoteLoadResponse> LoadQuotesAsync(string json, DateOnly? snapshotDate, CancellationToken cancellationToken = default);

    /// <summary>Returns active, non-test symbols grouped into request-sized batches.</summary>
    Task<List<BarchartQuoteBatchResponse>> GetQuoteBatchesAsync(int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Publishes current feed prices onto the Bid Sheet for linked locations.</summary>
    Task<BarchartApplyBidsResponse> ApplyBidsAsync(int? locationId, string? instrumentType, CancellationToken cancellationToken = default);

    /// <summary>Deactivates catalog entries last seen before the given time. Run only after a complete sweep.</summary>
    Task<BarchartDeactivateResponse> DeactivateInstrumentsAsync(DateTime lastSeenBeforeUtc, CancellationToken cancellationToken = default);

    /// <summary>Month-to-date ingest usage against the vendor cap.</summary>
    Task<BarchartBudgetResponse> GetBudgetAsync(int monthlyCap, CancellationToken cancellationToken = default);
}
