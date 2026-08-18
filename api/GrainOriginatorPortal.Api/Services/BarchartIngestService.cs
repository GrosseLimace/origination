using System.Diagnostics;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Receives BarChart payloads from the ingestion pipeline, validates them, and hands them to the
/// repository to be filed.
///
/// Payloads are never logged — only their size — because they are third-party commercial data and
/// logging bodies is prohibited by style-guides/logging.md. Every call is recorded in
/// dbo.BarchartApiCallAudit (success or failure) so monthly vendor usage stays queryable, which is
/// why failures are audited and then rethrown rather than swallowed.
/// </summary>
public class BarchartIngestService : IBarchartIngestService
{
    private readonly IBarchartIngestRepository _repository;
    private readonly ILogger<BarchartIngestService> _logger;

    /// <summary>Actor stamped on feed-written rows. Ingest callers are machine identities with no user name.</summary>
    private const string FeedActor = GrainOriginatorPortal.Infrastructure.Abstractions.BarchartFeedDefaults.Actor;

    /// <summary>
    /// Largest payload we accept. No repo-wide standard exists for request size, so this is set
    /// deliberately: an observed 100-symbol quote batch is ~50 KB and an instrument page a few hundred
    /// KB, making 10 MB generous while still bounding the memory a single call can consume.
    /// </summary>
    public const int MaxPayloadBytes = 10 * 1024 * 1024;

    /// <summary>
    /// Largest share of the active catalog one deactivation call may switch off before it is refused.
    /// Set from observed behaviour: a healthy sweep retires a handful of rolled-off symbols, so anything
    /// approaching a quarter of the book means the cutoff is wrong, not that the vendor dropped that much.
    /// </summary>
    public const int DefaultMaxDeactivationSharePercent = 25;

    public BarchartIngestService(IBarchartIngestRepository repository, ILogger<BarchartIngestService> logger)
    {
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <inheritdoc />
    public async Task<BarchartInstrumentLoadResponse> LoadInstrumentsAsync(
        string json, CancellationToken cancellationToken = default)
    {
        ValidatePayload(json);
        var sw = Stopwatch.StartNew();
        var bytes = System.Text.Encoding.UTF8.GetByteCount(json);

        try
        {
            var rows = await _repository.LoadInstrumentsAsync(json, cancellationToken);
            sw.Stop();

            _logger.LogInformation(
                "BarChart instrument load filed {RowsLoaded} rows from a {PayloadBytes}-byte payload in {Ms} ms [AUDIT_INGEST_INSTRUMENTS] [DataMutation]",
                rows, bytes, sw.ElapsedMilliseconds);

            await AuditAsync("ingest/instruments", $"payloadBytes={bytes}", 200, true, rows, sw, null, cancellationToken);
            return new BarchartInstrumentLoadResponse { RowsLoaded = rows };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            sw.Stop();
            await AuditFailureAsync("ingest/instruments", $"payloadBytes={bytes}", sw, ex, cancellationToken);
            throw;
        }
    }

    /// <inheritdoc />
    public async Task<BarchartQuoteLoadResponse> LoadQuotesAsync(
        string json, DateOnly? snapshotDate, CancellationToken cancellationToken = default)
    {
        ValidatePayload(json);
        var businessDate = snapshotDate ?? CentralBusinessDate();
        var sw = Stopwatch.StartNew();
        var bytes = System.Text.Encoding.UTF8.GetByteCount(json);

        try
        {
            var result = await _repository.LoadQuotesAsync(json, businessDate, cancellationToken);
            sw.Stop();

            _logger.LogInformation(
                "BarChart quote load upserted {QuotesUpserted} quotes for {SnapshotDate} ({UnknownSymbolCount} unknown symbols) from a {PayloadBytes}-byte payload in {Ms} ms [AUDIT_INGEST_QUOTES] [DataMutation]",
                result.QuotesUpserted, businessDate, result.UnknownSymbolCount, bytes, sw.ElapsedMilliseconds);

            // Quotes arriving for symbols we've never catalogued means the catalog is behind the
            // quote feed — worth a warning rather than burying it in the success line.
            if (result.UnknownSymbolCount > 0)
            {
                _logger.LogWarning(
                    "BarChart quote load skipped {UnknownSymbolCount} quotes whose symbols are absent from the instrument catalog — a catalog load is due [BARCHART_UNKNOWN_SYMBOLS] [DataQuality]",
                    result.UnknownSymbolCount);
            }

            await AuditAsync("ingest/quotes", $"snapshotDate={businessDate:yyyy-MM-dd};payloadBytes={bytes}",
                200, true, result.QuotesUpserted, sw, null, cancellationToken);

            return new BarchartQuoteLoadResponse
            {
                QuotesUpserted = result.QuotesUpserted,
                UnknownSymbolCount = result.UnknownSymbolCount,
                SnapshotDate = businessDate
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            sw.Stop();
            await AuditFailureAsync("ingest/quotes", $"snapshotDate={businessDate:yyyy-MM-dd};payloadBytes={bytes}", sw, ex, cancellationToken);
            throw;
        }
    }

    /// <inheritdoc />
    public async Task<List<BarchartQuoteBatchResponse>> GetQuoteBatchesAsync(
        int batchSize, CancellationToken cancellationToken = default)
    {
        if (batchSize < 1 || batchSize > 1000)
            throw new ValidationException(nameof(batchSize), "batchSize must be between 1 and 1000.");

        var batches = await _repository.GetQuoteBatchesAsync(batchSize, cancellationToken);

        _logger.LogInformation(
            "BarChart quote-batch request returned {BatchCount} batches of up to {BatchSize} symbols",
            batches.Count, batchSize);

        return batches
            .Select(b => new BarchartQuoteBatchResponse
            {
                BatchNumber = b.BatchNumber,
                SymbolCount = b.SymbolCount,
                SymbolsCsv = b.SymbolsCsv
            })
            .ToList();
    }

    /// <inheritdoc />
    public async Task<BarchartApplyBidsResponse> ApplyBidsAsync(
        int? locationId, string? instrumentType, CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();

        try
        {
            var rows = await _repository.ApplyBidsToBidSheetAsync(locationId, instrumentType, FeedActor, cancellationToken);
            sw.Stop();

            _logger.LogInformation(
                "BarChart bridge wrote or pruned {RowsAffected} bid cells (locationId={LocationId}, instrumentType={InstrumentType}) in {Ms} ms [AUDIT_INGEST_APPLY_BIDS] [DataMutation]",
                rows, locationId, instrumentType, sw.ElapsedMilliseconds);

            await AuditAsync("ingest/apply-bids",
                $"locationId={locationId?.ToString() ?? "all"};instrumentType={instrumentType ?? "any"}",
                200, true, rows, sw, null, cancellationToken);

            return new BarchartApplyBidsResponse { RowsAffected = rows };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            sw.Stop();
            await AuditFailureAsync("ingest/apply-bids", $"locationId={locationId?.ToString() ?? "all"}", sw, ex, cancellationToken);
            throw;
        }
    }

    /// <inheritdoc />
    public async Task<BarchartDeactivateResponse> DeactivateInstrumentsAsync(
        DateTime lastSeenBeforeUtc, int maxSharePercent = DefaultMaxDeactivationSharePercent,
        CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();

        // Blast-radius check before anything changes. The vendor sweep is sharded across several days,
        // so on any single day only a fraction of the catalog is re-seen — a cutoff picked as
        // "yesterday" would retire almost the whole book and silently empty every linked Bid Sheet
        // location. A share guard holds whatever the shard cadence turns out to be, where a fixed
        // minimum age would not. Raise maxSharePercent deliberately to force a large retirement through.
        var impact = await _repository.PreviewDeactivationAsync(lastSeenBeforeUtc, cancellationToken);
        if (impact.WouldDeactivate > 0 && impact.SharePercent > maxSharePercent)
        {
            sw.Stop();
            var message =
                $"Refusing to deactivate {impact.WouldDeactivate} of {impact.ActiveCount} active instruments " +
                $"({impact.SharePercent}%), which is over the {maxSharePercent}% limit. The catalog sweep is " +
                $"sharded across several days, so a cutoff must be older than one full cycle. Check " +
                $"lastSeenBefore, or pass maxSharePercent to override deliberately.";

            _logger.LogWarning(
                "BarChart deactivation refused: cutoff {LastSeenBeforeUtc} would switch off {WouldDeactivate} of {ActiveCount} instruments ({SharePercent}%), over the {MaxSharePercent}% limit [BARCHART_DEACTIVATE_REFUSED] [DataMutation]",
                lastSeenBeforeUtc, impact.WouldDeactivate, impact.ActiveCount, impact.SharePercent, maxSharePercent);

            await AuditAsync("ingest/deactivate-instruments",
                $"lastSeenBefore={lastSeenBeforeUtc:O};refused=1;wouldDeactivate={impact.WouldDeactivate}",
                400, false, 0, sw, message, cancellationToken);

            throw new ValidationException(nameof(lastSeenBeforeUtc), message);
        }

        var rows = await _repository.DeactivateMissingInstrumentsAsync(lastSeenBeforeUtc, cancellationToken);
        sw.Stop();

        _logger.LogInformation(
            "BarChart deactivation switched off {RowsDeactivated} instruments last seen before {LastSeenBeforeUtc} in {Ms} ms [AUDIT_INGEST_DEACTIVATE] [DataMutation]",
            rows, lastSeenBeforeUtc, sw.ElapsedMilliseconds);

        await AuditAsync("ingest/deactivate-instruments", $"lastSeenBefore={lastSeenBeforeUtc:O}",
            200, true, rows, sw, null, cancellationToken);

        return new BarchartDeactivateResponse { RowsDeactivated = rows };
    }

    /// <inheritdoc />
    public async Task<BarchartBudgetResponse> GetBudgetAsync(
        int monthlyCap, CancellationToken cancellationToken = default)
    {
        if (monthlyCap < 1)
            throw new ValidationException(nameof(monthlyCap), "monthlyCap must be greater than zero.");

        var budget = await _repository.GetApiBudgetAsync(monthlyCap, cancellationToken);

        if (budget.AbortRecommended)
        {
            _logger.LogWarning(
                "BarChart ingest usage has reached {MonthToDateCalls} of {MonthlyCap} calls this month — non-essential loads should stop [BARCHART_BUDGET_THRESHOLD] [Capacity]",
                budget.MonthToDateCalls, monthlyCap);
        }

        return new BarchartBudgetResponse
        {
            MonthToDateCalls = budget.MonthToDateCalls,
            RemainingCalls = budget.RemainingCalls,
            AbortRecommended = budget.AbortRecommended
        };
    }

    /// <inheritdoc />
    public async Task<BarchartPurgeResponse> PurgeHistoryAsync(
        int auditRetentionDays, int snapshotRetentionDays, CancellationToken cancellationToken = default)
    {
        // Guard rails rather than free choice: a tiny retention window would silently destroy price
        // history that the vendor API cannot rebuild.
        if (auditRetentionDays < 30)
            throw new ValidationException(nameof(auditRetentionDays), "auditRetentionDays must be at least 30.");
        if (snapshotRetentionDays < 90)
            throw new ValidationException(nameof(snapshotRetentionDays), "snapshotRetentionDays must be at least 90 — price history cannot be rebuilt from the vendor API.");

        var sw = Stopwatch.StartNew();
        var removed = await _repository.PurgeHistoryAsync(auditRetentionDays, snapshotRetentionDays, cancellationToken);
        sw.Stop();

        _logger.LogInformation(
            "BarChart history purge removed {RowsRemoved} rows (audit kept {AuditRetentionDays}d, price history kept {SnapshotRetentionDays}d) in {Ms} ms [AUDIT_INGEST_PURGE] [DataMutation]",
            removed, auditRetentionDays, snapshotRetentionDays, sw.ElapsedMilliseconds);

        return new BarchartPurgeResponse { RowsRemoved = removed };
    }

    /// <summary>
    /// Rejects payloads that can't possibly be a vendor response before any database work. The body is
    /// read raw rather than model-bound (vendor JSON carries fields we don't model, and the app rejects
    /// unknown members globally); the load SQL's OPENJSON clause is what whitelists the fields we use.
    /// </summary>
    private static void ValidatePayload(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            throw new ValidationException("body", "Request body is empty. POST the vendor response as-is.");

        var bytes = System.Text.Encoding.UTF8.GetByteCount(json);
        if (bytes > MaxPayloadBytes)
            throw new ValidationException("body", $"Request body is {bytes} bytes, which exceeds the {MaxPayloadBytes}-byte limit. Send smaller pages or batches.");

        var firstChar = json.AsSpan().TrimStart();
        if (firstChar.Length == 0 || (firstChar[0] != '{' && firstChar[0] != '['))
            throw new ValidationException("body", "Request body is not JSON. POST the vendor response as-is, uncompressed.");
    }

    /// <summary>
    /// Today's date in Central time. Loads run late in the day Central, which can already be tomorrow
    /// in UTC, so the business date must not be derived from the UTC clock.
    /// </summary>
    private static DateOnly CentralBusinessDate()
    {
        var central = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, central));
    }

    private async Task AuditAsync(
        string endpoint, string sanitizedParams, int httpStatus, bool success, int? rowsAffected,
        Stopwatch sw, string? errorMessage, CancellationToken cancellationToken)
    {
        // QueryParams is deliberately built from counts and dates only — never payload contents,
        // never a key or token.
        await _repository.LogApiCallAsync(new BarchartApiCallAudit
        {
            CalledAtUtc = DateTime.UtcNow,
            Endpoint = endpoint,
            QueryParams = Truncate(sanitizedParams, 2000),
            HttpStatus = httpStatus,
            Success = success,
            RowsAffected = rowsAffected,
            DurationMs = (int)Math.Min(sw.ElapsedMilliseconds, int.MaxValue),
            ErrorMessage = Truncate(errorMessage, 2000)
        }, cancellationToken);
    }

    /// <summary>
    /// Audits a failed call on a best-effort basis. A failure to record the audit must not replace the
    /// original exception, which is the one worth surfacing.
    /// </summary>
    private async Task AuditFailureAsync(
        string endpoint, string sanitizedParams, Stopwatch sw, Exception ex, CancellationToken cancellationToken)
    {
        _logger.LogError(ex,
            "BarChart ingest call to {Endpoint} failed after {Ms} ms [BARCHART_INGEST_FAILED] [Infrastructure]",
            endpoint, sw.ElapsedMilliseconds);

        try
        {
            await AuditAsync(endpoint, sanitizedParams, 500, false, null, sw, ex.Message, cancellationToken);
        }
        catch (Exception auditEx)
        {
            _logger.LogError(auditEx,
                "Failed to record the BarChart ingest audit row for {Endpoint} [BARCHART_AUDIT_WRITE_FAILED] [Infrastructure]",
                endpoint);
        }
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is null || value.Length <= maxLength ? value : value[..maxLength];
}
