using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Services;

public interface IOrganicCertificationService
{
    /// <summary>
    /// Certification for one producer. Always returns a record — a producer with no NOP id and one
    /// with a NOP id but no certification are different states and both must render.
    /// </summary>
    Task<CustomerOrganicCertificationResponse> GetForCustomerAsync(
        long customerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Every producer whose certification is not Certified, whether or not we watched it change.
    ///
    /// Bulk by design: Actionable Insights computes client-side over preloaded data and makes no
    /// per-customer calls, so it needs the whole flagged set in one read. The caller splits the
    /// result into the contracted and uncontracted categories — only it knows the contract
    /// position.
    /// </summary>
    Task<IReadOnlyList<OrganicCertificationStatusChangeResponse>> GetUnresolvedStatusChangesAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Producers who hold a NOP id with no certification behind it.
    ///
    /// ⚠️ Reads as "nothing has reached us for them", which is only interesting once the feed is
    /// actually running. Until it is, EVERY organic producer qualifies — roughly 580 — so the
    /// surface showing this must not be switched on before the feed is live.
    /// </summary>
    Task<IReadOnlyList<OrganicMissingCertificateResponse>> GetMissingCertificatesAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Whether one nightly run finished, by its feed run id.
    ///
    /// This is the gate on ever acting on a producer's absence: until a run is known Complete, the
    /// difference between "this producer stopped being certified" and "the run never reached them"
    /// is unknowable.
    /// </summary>
    Task<OrganicRunCompletenessResponse> GetRunCompletenessAsync(
        string feedRunId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The most recent runs with their outcomes, newest first. The operational view: did last
    /// night's feed finish, and the one before that.
    /// </summary>
    Task<IReadOnlyList<OrganicRunCompletenessResponse>> GetRecentRunsAsync(
        int take = 14, CancellationToken cancellationToken = default);
}

/// <summary>
/// Reads certification for the producer profile.
///
/// ── The join ──
/// <c>Customer.NopIdNumber → OrganicCertification.Nopid</c>, not customer to certification. One NOP
/// id legitimately covers several customer records — family operations, a person and their LLC —
/// and they all read the same row. That is why there is no junction table, and why the question of
/// whether to present those as one operation or several is a rendering decision rather than a
/// storage one.
///
/// ── Not trade-unit scoped, deliberately ──
/// Do NOT cite AR-02 here. The test the codebase applies (see ProducerDetailsController) is whether
/// the response carries PII and whether any client path needs it cross-trade-unit. This payload is
/// a NOP id, a status, dates and crop names — public-registry facts with no personal data, and the
/// contact block from the source is deliberately neither stored nor returned. Kate Hoegermeyer
/// confirmed certification status is not confidential. Both legs fail, so the read stays unscoped.
/// </summary>
public class OrganicCertificationService : IOrganicCertificationService
{
    private readonly ApplicationDbContext _db;
    private readonly IConfiguration _config;
    private readonly TimeProvider _timeProvider;

    public OrganicCertificationService(
        ApplicationDbContext db,
        IConfiguration config,
        TimeProvider? timeProvider = null)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    /// <summary>
    /// The desk's compliance window in months. Configurable so the threshold can move without a
    /// deploy — it is a business rule from their certifier, not a technical constant.
    /// </summary>
    private int ComplianceWindowMonths =>
        _config.GetValue<int?>("OrganicCertification:ComplianceWindowMonths")
        ?? OrganicRecordCurrency.DefaultComplianceWindowMonths;

    public async Task<CustomerOrganicCertificationResponse> GetForCustomerAsync(
        long customerId, CancellationToken cancellationToken = default)
    {
        var nopid = await _db.Customers
            .Where(c => c.Id == customerId)
            .Select(c => c.NopIdNumber)
            .FirstOrDefaultAsync(cancellationToken);

        nopid = string.IsNullOrWhiteSpace(nopid) ? null : nopid.Trim();

        if (nopid is null)
        {
            // No NOP id on file. Not a warning state — the badge may still be showing on the
            // industry code alone, and that is legitimate.
            return new CustomerOrganicCertificationResponse { CustomerId = customerId };
        }

        var certification = await _db.OrganicCertifications
            .AsNoTracking()
            .Include(c => c.Scopes)
            .Include(c => c.Items)
            .FirstOrDefaultAsync(c => c.Nopid == nopid, cancellationToken);

        if (certification is null)
        {
            // A NOP id with nothing behind it. The desk asked for this to be visible: show the id
            // as usual, and warn. It means the producer holds no current certificate, or the feed
            // has not reached us for them yet — a trader wants to know either way.
            return new CustomerOrganicCertificationResponse
            {
                CustomerId = customerId,
                Nopid = nopid,
                NoCertificateOnFile = true,
            };
        }

        return new CustomerOrganicCertificationResponse
        {
            CustomerId = customerId,
            Nopid = nopid,
            NoCertificateOnFile = false,
            Certification = Map(certification, _timeProvider.GetUtcNow().UtcDateTime,
                                ComplianceWindowMonths),
        };
    }

    public async Task<IReadOnlyList<OrganicCertificationStatusChangeResponse>>
        GetUnresolvedStatusChangesAsync(CancellationToken cancellationToken = default)
    {
        // Flags on CURRENT status alone — it no longer requires PreviousStatus to be set.
        //
        // It used to, and that quietly lost people: a producer whose very first message already
        // said Surrendered had never "changed" in our view, so they appeared on no list anywhere.
        // The desk asked for them (2026-10-07) — "any producer with a non-certified certificate
        // should show up in one of the two categories" — and meeting someone already surrendered
        // is not a reason to stay quiet about it.
        //
        // PreviousStatus is still selected and still returned: when we did watch the change, the
        // desk wants to see what it moved from. It is now display detail rather than a filter.
        //
        // Narrowed in the database to rows that HAVE a status, then the Certified test is applied
        // in memory against the shared rule rather than duplicated as SQL — one definition of
        // "needs attention", used by the profile and both insight categories alike.
        var withStatus = await _db.OrganicCertifications
            .AsNoTracking()
            .Where(c => c.Nopid != null && c.OperationStatus != null && c.OperationStatus != "")
            .Select(c => new
            {
                c.Nopid,
                c.OperationName,
                c.OperationStatus,
                c.PreviousStatus,
                c.StatusEffectiveDate,
                c.StatusChangedOn,
            })
            .ToListAsync(cancellationToken);

        var unresolved = withStatus
            .Where(c => OrganicCertificationStatus.NeedsAttention(c.OperationStatus))
            .ToList();

        if (unresolved.Count == 0) return [];

        // Fan out to every customer carrying one of those NOP ids. A single certification can
        // cover several customer records, and each affected producer needs its own alert.
        var nopids = unresolved.Select(c => c.Nopid).ToList();

        var customers = await _db.Customers
            .AsNoTracking()
            .Where(c => c.NopIdNumber != null && nopids.Contains(c.NopIdNumber))
            .Select(c => new { c.Id, c.ScoularId, c.NopIdNumber })
            .ToListAsync(cancellationToken);

        var byNopid = unresolved.ToDictionary(c => c.Nopid!, StringComparer.OrdinalIgnoreCase);

        return customers
            .Where(cust => byNopid.ContainsKey(cust.NopIdNumber!))
            .Select(cust =>
            {
                var cert = byNopid[cust.NopIdNumber!];
                return new OrganicCertificationStatusChangeResponse
                {
                    CustomerId = cust.Id,
                    ScoularId = cust.ScoularId,
                    Nopid = cert.Nopid!,
                    OperationName = cert.OperationName,
                    Status = cert.OperationStatus,
                    PreviousStatus = cert.PreviousStatus,
                    StatusEffectiveDate = cert.StatusEffectiveDate,
                    StatusChangedOn = cert.StatusChangedOn,
                };
            })
            .OrderBy(r => r.ScoularId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<OrganicMissingCertificateResponse>> GetMissingCertificatesAsync(
        CancellationToken cancellationToken = default)
    {
        // The two halves come from different pipelines, which is the whole point of the check:
        // the NOP id arrives from Profisee through the nightly customer sync, the certification
        // from the integration team's feed. A producer here is one where the first says they are
        // certified organic and the second has never confirmed it.
        //
        // Anti-join rather than a NOT EXISTS correlated per row: the certification table is small
        // (one row per NOP id, ~1,000 at most) so pulling its id set and filtering in memory costs
        // one cheap read, and keeps the comparison on the SAME trimmed, case-insensitive terms the
        // rest of this file joins on. A SQL-side join would silently use the database collation.
        var certifiedNopids = await _db.OrganicCertifications
            .AsNoTracking()
            .Where(c => c.Nopid != null)
            .Select(c => c.Nopid!)
            .ToListAsync(cancellationToken);

        var known = new HashSet<string>(certifiedNopids, StringComparer.OrdinalIgnoreCase);

        var withNopId = await _db.Customers
            .AsNoTracking()
            .Where(c => c.IsActive && c.NopIdNumber != null && c.NopIdNumber != "")
            .Select(c => new { c.Id, c.ScoularId, c.Name, c.NopIdNumber })
            .ToListAsync(cancellationToken);

        return withNopId
            .Where(c => !known.Contains(c.NopIdNumber!.Trim()))
            .Select(c => new OrganicMissingCertificateResponse
            {
                CustomerId = c.Id,
                ScoularId = c.ScoularId,
                Nopid = c.NopIdNumber!.Trim(),
                CustomerName = c.Name,
            })
            .OrderBy(r => r.ScoularId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<OrganicRunCompletenessResponse> GetRunCompletenessAsync(
        string feedRunId, CancellationToken cancellationToken = default)
    {
        var runId = feedRunId?.Trim();
        if (string.IsNullOrEmpty(runId))
        {
            return new OrganicRunCompletenessResponse
            {
                FeedRunId = string.Empty,
                Outcome = nameof(OrganicRunCompleteness.Outcome.NotAssessable),
                Summary = "No feed run id supplied.",
            };
        }

        // Compared whole and case-insensitively. The run id is the sender's, and we deliberately
        // never parse it — see OrganicRunCompletenessTests for why the "replay-" prefix is not a
        // rule here.
        var rows = await _db.OrganicCertificationLoads
            .AsNoTracking()
            .Where(l => l.FeedRunId != null && l.FeedRunId == runId)
            .Select(l => new
            {
                l.RunPosition,
                l.RunTotal,
                l.ScoularId,
                l.Status,
                l.ReceivedOn,
            })
            .ToListAsync(cancellationToken);

        return Describe(runId, rows.Select(r =>
            (r.RunPosition, r.RunTotal, r.ScoularId, r.Status, r.ReceivedOn)).ToList());
    }

    public async Task<IReadOnlyList<OrganicRunCompletenessResponse>> GetRecentRunsAsync(
        int take = 14, CancellationToken cancellationToken = default)
    {
        var limit = Math.Clamp(take, 1, 90);

        // Which runs, newest first, before pulling their rows. Ordering by the latest message in
        // each run rather than by the id, because the id is opaque and may not sort chronologically.
        var runIds = await _db.OrganicCertificationLoads
            .AsNoTracking()
            .Where(l => l.FeedRunId != null && l.RunTotal != null)
            .GroupBy(l => l.FeedRunId!)
            .Select(g => new { FeedRunId = g.Key, LastSeen = g.Max(l => l.ReceivedOn) })
            .OrderByDescending(g => g.LastSeen)
            .Take(limit)
            .ToListAsync(cancellationToken);

        if (runIds.Count == 0) return [];

        var ids = runIds.Select(r => r.FeedRunId).ToList();

        var rows = await _db.OrganicCertificationLoads
            .AsNoTracking()
            .Where(l => l.FeedRunId != null && ids.Contains(l.FeedRunId))
            .Select(l => new
            {
                l.FeedRunId,
                l.RunPosition,
                l.RunTotal,
                l.ScoularId,
                l.Status,
                l.ReceivedOn,
            })
            .ToListAsync(cancellationToken);

        var byRun = rows.GroupBy(r => r.FeedRunId!)
                        .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        return runIds
            .Where(r => byRun.ContainsKey(r.FeedRunId))
            .Select(r => Describe(r.FeedRunId, byRun[r.FeedRunId]
                .Select(x => (x.RunPosition, x.RunTotal, x.ScoularId, x.Status, x.ReceivedOn))
                .ToList()))
            .ToList();
    }

    /// <summary>
    /// Turns one run's audit rows into the answer a person wants at 9am.
    ///
    /// The rules themselves live in <see cref="OrganicRunCompleteness"/>, which knows nothing about
    /// the database and is unit-tested exhaustively. This method only supplies the rows and adds the
    /// human-readable context around the verdict.
    /// </summary>
    private static OrganicRunCompletenessResponse Describe(
        string feedRunId,
        IReadOnlyList<(int? Position, int? Total, string? ScoularId, string Status, DateTime ReceivedOn)> rows)
    {
        var result = OrganicRunCompleteness.Assess(
            rows.Select(r => new OrganicRunCompleteness.RunMessage(r.Position, r.Total, r.ScoularId)));

        var skipped = rows.Count(r => string.Equals(r.Status, "Skipped", StringComparison.OrdinalIgnoreCase));
        var rejected = rows.Count(r => string.Equals(r.Status, "Rejected", StringComparison.OrdinalIgnoreCase));
        var stored = rows.Count(r => string.Equals(r.Status, "Succeeded", StringComparison.OrdinalIgnoreCase));

        return new OrganicRunCompletenessResponse
        {
            FeedRunId = feedRunId,
            Outcome = result.Outcome.ToString(),
            Summary = Summarise(result, skipped, rejected),
            RunTotal = result.RunTotal,
            DistinctPositionsReceived = result.DistinctPositionsReceived,
            MissingCount = result.MissingCount,
            MissingPositions = result.MissingPositions,
            Problems = result.Problems,
            MessagesReceived = rows.Count,
            Stored = stored,
            Skipped = skipped,
            Rejected = rejected,
            FirstMessageOn = rows.Count == 0 ? null : rows.Min(r => r.ReceivedOn),
            LastMessageOn = rows.Count == 0 ? null : rows.Max(r => r.ReceivedOn),
        };
    }

    private static string Summarise(OrganicRunCompleteness.Result result, int skipped, int rejected)
        => result.Outcome switch
        {
            OrganicRunCompleteness.Outcome.Complete =>
                $"Run finished. All {result.RunTotal} positions accounted for"
                + (skipped > 0 ? $", including {skipped} the sender skipped" : string.Empty)
                + (rejected > 0 ? $", and {rejected} we could not use" : string.Empty)
                + ".",

            OrganicRunCompleteness.Outcome.Incomplete =>
                $"Run did not finish, or is still running. {result.DistinctPositionsReceived} of "
                + $"{result.RunTotal} positions received; {result.MissingCount} missing. "
                + "Do not treat a producer's absence as meaningful.",

            OrganicRunCompleteness.Outcome.Invalid =>
                "Run is internally inconsistent and its numbers cannot be trusted. "
                + string.Join(" ", result.Problems),

            _ => "Not a nightly run — no message carried a run total. Replays and intraday edits "
               + "look like this by design.",
        };

    private static OrganicCertificationResponse Map(
        Infrastructure.Data.Entities.OrganicCertification source,
        DateTime asOf,
        int complianceWindowMonths) => new()
    {
        Nopid = source.Nopid,
        OperationName = source.OperationName,
        CertifierName = source.CertifierName,
        Status = source.OperationStatus,
        IsCertified = OrganicCertificationStatus.IsCertified(source.OperationStatus),

        // Operation status, or a surrendered Crops or Handling scope. Livestock is the only scope
        // that does not count — see OrganicCertificationStatus.IsSurrendered.
        IsSurrendered = OrganicCertificationStatus.IsSurrendered(
            source.OperationStatus,
            source.Scopes.Select(s => (s.Scope, s.ScopeStatus))),

        StatusEffectiveDate = source.StatusEffectiveDate,
        AnniversaryDate = source.AnniversaryDate,
        TotalAcreage = source.TotalAcreage,

        // The desk's compliance signal, measured against the certifier's "updated on" date because
        // no certificate issue date exists in queryable form. Computed here so the client renders a
        // boolean rather than doing date arithmetic in a timezone we do not control.
        SourceUpdatedOn = source.SourceLastUpdateDate,
        MonthsSinceSourceUpdate = OrganicRecordCurrency.MonthsSinceUpdate(
            source.SourceLastUpdateDate, asOf),
        OutsideComplianceWindow = OrganicRecordCurrency.IsOutsideWindow(
            source.SourceLastUpdateDate, asOf, complianceWindowMonths),

        // Moved here from the panel component on 2026-10-07, when this became a badge signal as
        // well as a panel one. Two surfaces doing the same date comparison in the browser's
        // timezone is exactly how a badge ends up amber while the panel behind it says the date is
        // fine. A missing anniversary is NOT past due — ~15% of real records have none, and absence
        // is not evidence of lateness (unlike the compliance window, where absence fails safe
        // because the desk's requirement is positive proof of currency).
        AnniversaryPastDue = source.AnniversaryDate is { } anniversary
                             && anniversary.Date < asOf.Date,

        // Shared rule, so the profile and Actionable Insights cannot drift apart.
        HasUnresolvedStatusChange = OrganicCertificationStatus.HasUnresolvedStatusChange(
            source.OperationStatus, source.PreviousStatus),
        PreviousStatus = source.PreviousStatus,
        StatusChangedOn = source.StatusChangedOn,

        Scopes = BuildScopes(source),
        UpdatedOn = source.UpdatedOn,
    };

    /// <summary>
    /// Groups crops under the scope that certifies them.
    ///
    /// Items name their own scope, so they are matched to it case-insensitively — the source is
    /// title case ("Crops") and nothing guarantees it stays that way. An item whose scope matches
    /// no declared scope still has to appear, or a trader loses a crop to a data inconsistency, so
    /// those are collected under their own heading rather than dropped.
    /// </summary>
    private static List<OrganicCertificationScopeResponse> BuildScopes(
        Infrastructure.Data.Entities.OrganicCertification source)
    {
        var scopes = source.Scopes
            .OrderBy(s => s.Scope, StringComparer.OrdinalIgnoreCase)
            .Select(s => new OrganicCertificationScopeResponse
            {
                Scope = s.Scope,
                Status = s.ScopeStatus,
                IsCertified = OrganicCertificationStatus.IsCertified(s.ScopeStatus),
                StatusEffectiveDate = s.StatusEffectiveDate,
                Crops = CropsForScope(source, s.Scope),
            })
            .ToList();

        var declared = source.Scopes
            .Select(s => s.Scope?.Trim() ?? string.Empty)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var orphanedScopes = source.Items
            .Select(i => i.Scope?.Trim())
            .Where(s => !string.IsNullOrEmpty(s) && !declared.Contains(s!))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s, StringComparer.OrdinalIgnoreCase);

        foreach (var orphan in orphanedScopes)
        {
            scopes.Add(new OrganicCertificationScopeResponse
            {
                Scope = orphan!,
                Status = null,
                IsCertified = false,
                Crops = CropsForScope(source, orphan),
            });
        }

        return scopes;
    }

    private static List<string> CropsForScope(
        Infrastructure.Data.Entities.OrganicCertification source, string? scope)
    {
        var crops = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in source.Items.Where(i =>
            string.Equals(i.Scope?.Trim(), scope?.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            // One item can yield several crops: a free-text entry is a whole list.
            foreach (var crop in OrganicCertifiedCrops.ForItem(item.ItemName, item.OtherItems))
            {
                if (seen.Add(crop)) crops.Add(crop);
            }
        }

        return crops;
    }
}
