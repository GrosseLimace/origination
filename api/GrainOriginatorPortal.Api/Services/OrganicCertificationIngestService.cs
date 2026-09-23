using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Files NOP certification messages from the integration.
///
/// Three rules shape everything here.
///
/// 1. A message about a producer we do not have is ACCEPTED, with a null CustomerId. Rejecting it
///    would make a producer-onboarding gap look like a feed failure, and would lose the
///    certification until someone noticed. Stored now, it appears the moment they are onboarded.
///
/// 2. One bad child does not sink the message. A malformed crop is dropped and named in the
///    response; the operation and its remaining children still store. The opposite — failing the
///    whole certification over one unreadable item — loses good compliance data.
///
/// 3. The payload is never logged. Size and counts only, matching the BarChart audit posture.
///    Certification data is customer data.
///
/// Retry-safety is structural rather than bolted on: the operation upserts on NOP id, and scopes
/// and items are replaced as a set. The feed is a full nightly snapshot, so a re-sent message
/// converges to the same state.
/// </summary>
public class OrganicCertificationIngestService : IOrganicCertificationIngestService
{
    private readonly ApplicationDbContext _db;
    private readonly ILogger<OrganicCertificationIngestService> _logger;
    private readonly TimeProvider _timeProvider;

    public OrganicCertificationIngestService(
        ApplicationDbContext db,
        ILogger<OrganicCertificationIngestService> logger,
        TimeProvider? timeProvider = null)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public async Task<OrganicCertificationIngestResponse> IngestAsync(
        OrganicCertificationIngestRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var batchId = Guid.NewGuid();
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var rejections = new List<OrganicCertificationRejection>();

        var nopid = request.Operation.NopOperationId?.Trim();
        if (string.IsNullOrEmpty(nopid))
        {
            // The only failure that loses the whole message: with no NOP id there is no key to
            // store it under and nothing for a producer to join to.
            rejections.Add(new OrganicCertificationRejection
            {
                Element = "operation",
                Code = "MISSING_NOP_OPERATION_ID",
                Message = "nopOperationID is required and was empty.",
            });

            await AuditAsync(batchId, null, "Rejected", accepted: 0, rejected: 1,
                unmatchedCustomer: 0, "Message carried no NOP operation id.", now, cancellationToken);

            return new OrganicCertificationIngestResponse
            {
                BatchId = batchId,
                Nopid = null,
                Accepted = false,
                CustomerMatched = false,
                Rejections = rejections,
            };
        }

        // Deliberately NOT applying the ten-digit rule the customer sync uses on ODS NopIdNumber.
        // That rule exists to strip ODS placeholders ("0", "999999999") out of OUR customer master.
        // These ids come from USDA INTEGRITY via the certifier, where we have no evidence every
        // operation id is ten digits — imposing that shape could silently discard legitimate
        // certifications. Length and presence are all that is enforced.
        var scoularId = request.ScoularId?.Trim();
        var customerId = await ResolveCustomerIdAsync(scoularId, cancellationToken);

        var certification = await _db.OrganicCertifications
            .Include(c => c.Scopes)
            .Include(c => c.Items)
            .FirstOrDefaultAsync(c => c.Nopid == nopid, cancellationToken);

        if (certification is null)
        {
            certification = new OrganicCertification { Nopid = nopid };
            _db.OrganicCertifications.Add(certification);
        }

        ApplyOperation(certification, request.Operation, scoularId, customerId, batchId, now);

        var scopesStored = ApplyScopes(certification, request.Scopes, now, rejections);
        var itemsStored = ApplyItems(certification, request.Items, now, rejections);

        await _db.SaveChangesAsync(cancellationToken);

        await AuditAsync(batchId, nopid, "Succeeded", accepted: 1, rejected: rejections.Count,
            unmatchedCustomer: customerId is null ? 1 : 0,
            $"scopes={scopesStored};items={itemsStored}", now, cancellationToken);

        // Counts and identifiers only — never the payload.
        _logger.LogInformation(
            "Organic certification filed for NOPID {Nopid}: {ScopesStored} scopes, {ItemsStored} items, "
            + "{RejectionCount} rejected, customer {CustomerMatched} [AUDIT_INGEST_ORGANIC] [DataMutation]",
            nopid, scopesStored, itemsStored, rejections.Count,
            customerId is null ? "unmatched" : "matched");

        return new OrganicCertificationIngestResponse
        {
            BatchId = batchId,
            Nopid = nopid,
            Accepted = true,
            CustomerMatched = customerId is not null,
            ScopesStored = scopesStored,
            ItemsStored = itemsStored,
            Rejections = rejections,
        };
    }

    /// <summary>
    /// Matches the sender's customer code to a producer. Trimmed and compared case-insensitively
    /// because ODS stores some codes CHAR-padded and the sender may not normalise casing.
    /// </summary>
    private async Task<long?> ResolveCustomerIdAsync(string? scoularId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(scoularId)) return null;

        return await _db.Customers
            .Where(c => c.ScoularId != null && c.ScoularId.Trim() == scoularId)
            .Select(c => (long?)c.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static void ApplyOperation(
        OrganicCertification target,
        OrganicOperationDto source,
        string? scoularId,
        long? customerId,
        Guid batchId,
        DateTime now)
    {
        target.ScoularId = scoularId;
        target.CustomerId = customerId;
        target.OperationName = source.OperationName;
        target.OperationOtherNames = source.OperationOtherNames;
        target.ClientOperationId = source.ClientOperationId;
        target.CertifierName = source.CertifierName;
        target.OperationStatus = source.NopOperationStatus;
        target.StatusEffectiveDate = source.StatusEffectiveDate?.Date;
        target.AnniversaryDate = source.NopAnniversaryDate?.Date;
        target.SourceLastUpdateDate = source.LastUpdateDate?.Date;
        target.HasCertificate = source.HasCertificate ?? false;
        target.CertificateUrl = source.CertificateUrl;
        target.TotalAcreage = source.TotalAcreage;

        // Presence in the feed is the active signal. Nothing here ever sets IsActive false: with
        // one message per producer there is no batch boundary, so absence is undetectable — we
        // cannot tell "not sent tonight" from "unchanged". Deactivation therefore has to come from
        // an explicit terminal status, or from a run id the sender does not currently supply.
        target.IsActive = true;
        target.DeactivatedOn = null;

        target.UpdatedOn = now;
        target.LoadBatchId = batchId;
    }

    /// <summary>
    /// Replaces the scope set. Duplicates within one message are reported rather than dropped
    /// silently — the unique index would reject them anyway, and a silent drop hides a sender bug.
    /// </summary>
    private int ApplyScopes(
        OrganicCertification certification,
        IReadOnlyList<OrganicScopeDto>? scopes,
        DateTime now,
        List<OrganicCertificationRejection> rejections)
    {
        certification.Scopes.Clear();
        if (scopes is null || scopes.Count == 0) return 0;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var scope in scopes)
        {
            var name = scope.NopScope?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                rejections.Add(new OrganicCertificationRejection
                {
                    Element = "scope",
                    Code = "MISSING_SCOPE",
                    Message = "nopScope is required and was empty.",
                });
                continue;
            }

            if (!seen.Add(name))
            {
                rejections.Add(new OrganicCertificationRejection
                {
                    Element = "scope",
                    Identifier = name,
                    Code = "DUPLICATE_SCOPE",
                    Message = $"Scope '{name}' appeared more than once in this message.",
                });
                continue;
            }

            certification.Scopes.Add(new OrganicCertificationScope
            {
                Scope = name,
                ScopeStatus = scope.ScopeStatus,
                StatusEffectiveDate = scope.StatusEffectiveDate?.Date,
                UpdatedOn = now,
            });
        }

        return certification.Scopes.Count;
    }

    /// <summary>
    /// Replaces the item set. An empty collection is normal, not an error — a surrendered
    /// operation arrives with no items at all.
    /// </summary>
    private int ApplyItems(
        OrganicCertification certification,
        IReadOnlyList<OrganicItemDto>? items,
        DateTime now,
        List<OrganicCertificationRejection> rejections)
    {
        certification.Items.Clear();
        if (items is null || items.Count == 0) return 0;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            var id = item.ItemId?.Trim();
            if (string.IsNullOrEmpty(id))
            {
                rejections.Add(new OrganicCertificationRejection
                {
                    Element = "item",
                    Code = "MISSING_ITEM_ID",
                    Message = "itemId is required and was empty.",
                });
                continue;
            }

            if (!seen.Add(id))
            {
                rejections.Add(new OrganicCertificationRejection
                {
                    Element = "item",
                    Identifier = id,
                    Code = "DUPLICATE_ITEM_ID",
                    Message = $"Item id '{id}' appeared more than once in this message.",
                });
                continue;
            }

            certification.Items.Add(new OrganicCertificationItem
            {
                ItemId = id,
                Scope = item.NopScope,
                CertificateNumber = item.CertificateNumber,
                Status = item.Status,
                StatusEffectiveDate = item.StatusEffectiveDate?.Date,
                // Stored verbatim. An item name that maps to no Scoular commodity is a vocabulary
                // mismatch, not bad data, and is resolved softly at read time.
                ItemName = item.ItemName,
                CategoryName = item.CategoryName,
                CategoryId = item.CategoryId,
                ItemVarieties = item.ItemVarieties,
                OtherItems = item.OtherItems,
                Organic = item.Organic ?? false,
                Organic100 = item.Organic100 ?? false,
                MadeWithOrganic = item.MadeWithOrganic ?? false,
                UpdatedOn = now,
            });
        }

        return certification.Items.Count;
    }

    /// <summary>
    /// Records that the call happened, whatever the outcome. This is what makes "did last night's
    /// feed actually reach us?" answerable without opening SSMS — the question BarChart's audit
    /// table earned its keep on when a caller believed it had posted and had not.
    /// </summary>
    private async Task AuditAsync(
        Guid batchId,
        string? nopid,
        string status,
        int accepted,
        int rejected,
        int unmatchedCustomer,
        string? message,
        DateTime now,
        CancellationToken cancellationToken)
    {
        _db.OrganicCertificationLoads.Add(new OrganicCertificationLoad
        {
            BatchId = batchId,
            Nopid = nopid,
            ReceivedOn = now,
            Status = status,
            Accepted = accepted,
            Rejected = rejected,
            UnmatchedCustomer = unmatchedCustomer,
            Message = message,
        });

        await _db.SaveChangesAsync(cancellationToken);
    }
}
