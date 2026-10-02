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
    /// Every producer whose certification status has changed and has not returned to Certified.
    ///
    /// Bulk by design: Actionable Insights computes client-side over preloaded data and makes no
    /// per-customer calls, so it needs the whole flagged set in one read. The set is naturally
    /// small — only certifications that actually moved.
    /// </summary>
    Task<IReadOnlyList<OrganicCertificationStatusChangeResponse>> GetUnresolvedStatusChangesAsync(
        CancellationToken cancellationToken = default);
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
        // Narrow in the database before joining: PreviousStatus set is a cheap, highly selective
        // filter, and only a handful of certifications ever carry one. The "not Certified" half is
        // applied in memory against the shared rule rather than duplicated as SQL — one definition
        // of "still flagged", used by the profile and this list alike.
        var changed = await _db.OrganicCertifications
            .AsNoTracking()
            .Where(c => c.PreviousStatus != null && c.PreviousStatus != "" && c.Nopid != null)
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

        var unresolved = changed
            .Where(c => OrganicCertificationStatus.HasUnresolvedStatusChange(
                c.OperationStatus, c.PreviousStatus))
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
