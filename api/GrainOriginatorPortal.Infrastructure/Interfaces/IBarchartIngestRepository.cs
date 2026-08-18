using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Data access for the BarChart bid feed. Every write is a parameterized set-based statement — the
/// App Service identity holds read/write on this database but not EXECUTE, so this logic ships as
/// SQL sent from here rather than as stored procedures.
///
/// All operations are safe to repeat: loads upsert, the daily snapshot replaces same-date rows, and
/// the bridge is deterministic. That's what lets the ingest endpoints be retried without cleanup.
/// </summary>
public interface IBarchartIngestRepository
{
    /// <summary>
    /// Loads a vendor instrument (catalog) payload. Accepts the vendor envelope or a bare JSON array,
    /// parses the location key / root / price type / delivery-window flag out of each symbol, flags
    /// vendor test rows, and upserts on symbol. Symbols absent from the payload are left untouched —
    /// removal is the separate, deliberate <see cref="DeactivateMissingInstrumentsAsync"/> step.
    /// </summary>
    /// <returns>Rows inserted or updated.</returns>
    Task<int> LoadInstrumentsAsync(string json, CancellationToken cancellationToken = default);

    /// <summary>
    /// Loads a vendor quote payload: refreshes the current price per symbol and records the day's
    /// history row. Re-running for the same <paramref name="snapshotDate"/> replaces that day's rows
    /// rather than duplicating them. Quotes for symbols missing from the catalog are skipped and counted.
    /// </summary>
    Task<BarchartQuoteLoadResult> LoadQuotesAsync(string json, DateOnly snapshotDate, CancellationToken cancellationToken = default);

    /// <summary>Returns active, non-test symbols grouped into batches of <paramref name="batchSize"/>.</summary>
    Task<List<BarchartQuoteBatch>> GetQuoteBatchesAsync(int batchSize, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deactivates instruments last seen before <paramref name="lastSeenBeforeUtc"/>. Intended to run
    /// only after a complete catalog sweep — rows are flagged inactive, never deleted, so a partial
    /// vendor pull can't strip the catalog from under a linked Bid Sheet location.
    /// </summary>
    Task<int> DeactivateMissingInstrumentsAsync(DateTime lastSeenBeforeUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// How many instruments a proposed cutoff would switch off, and out of how many. Lets the caller
    /// refuse an obviously wrong cutoff before any rows change, which matters because the vendor sweep
    /// is sharded over several days and a naive "not seen since yesterday" would retire most of the book.
    /// </summary>
    Task<BarchartDeactivationImpact> PreviewDeactivationAsync(DateTime lastSeenBeforeUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// Copies current feed prices onto the Bid Sheet for locations linked to a BarChart location key.
    /// Writes only cells owned by the feed, never touches manually entered bids, and prunes its own
    /// rows once a delivery window or commodity mapping goes away.
    /// </summary>
    /// <param name="locationId">Limit to one Bid Sheet location; null processes every linked location.</param>
    /// <param name="instrumentType">Vendor price type to publish, e.g. <c>bidCash</c>. Null publishes any type.</param>
    /// <param name="appliedBy">Actor recorded on written rows.</param>
    /// <returns>Bid rows written or removed.</returns>
    Task<int> ApplyBidsToBidSheetAsync(int? locationId, string? instrumentType, string appliedBy, CancellationToken cancellationToken = default);

    /// <summary>Records one ingest call for monthly usage tracking.</summary>
    Task LogApiCallAsync(BarchartApiCallAudit audit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Trims the two tables that would otherwise grow without bound: the call audit and the daily price
    /// history. Deletes in batches so a long-overdue purge can't hold a single enormous transaction.
    /// </summary>
    /// <param name="auditRetentionDays">Keep audit rows newer than this.</param>
    /// <param name="snapshotRetentionDays">Keep price history newer than this.</param>
    /// <returns>Rows removed across both tables.</returns>
    Task<int> PurgeHistoryAsync(
        int auditRetentionDays, int snapshotRetentionDays, CancellationToken cancellationToken = default);

    /// <summary>Month-to-date ingest-call usage against <paramref name="monthlyCap"/>.</summary>
    Task<BarchartApiBudget> GetApiBudgetAsync(int monthlyCap, CancellationToken cancellationToken = default);
}
