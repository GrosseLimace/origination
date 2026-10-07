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

        // The sender's run id, shared across every message in one nightly run. Read here so that
        // even a message rejected for having no NOP id still records which run it came from —
        // "run X sent 1,000 messages and 3 were unusable" is only answerable if the unusable ones
        // carry the id too. Null is normal and must never be a rejection reason.
        var feedRunId = request.FeedRunId?.Trim();
        if (string.IsNullOrEmpty(feedRunId)) feedRunId = null;

        var nopid = request.NopOperationId?.Trim();
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

            await AuditAsync(batchId, feedRunId, null, "Rejected", accepted: 0, rejected: 1,
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
        // The audit row goes in FIRST, on its own save, and is promoted to Succeeded later.
        //
        // Written before any certification work so that a later failure cannot take it with it: if
        // the main save throws, this row survives as "Received", and "did the feed reach us?" —
        // the one question this table exists to answer — stays answerable on exactly the night it
        // matters. Auditing afterwards left no row at all in that case, which reads identically to
        // the feed never having run (Caden Egr, review 2026-10-02).
        //
        // Costs one extra round trip per message. At roughly a thousand nightly that is nothing
        // against losing the arrival record of the one that failed.
        var auditRow = new OrganicCertificationLoad
        {
            BatchId = batchId,
            FeedRunId = feedRunId,
            Nopid = nopid,
            ReceivedOn = now,
            Status = "Received",
            Message = "Arrived; write not yet confirmed.",
        };
        _db.OrganicCertificationLoads.Add(auditRow);
        await _db.SaveChangesAsync(cancellationToken);

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

        ApplyOperation(certification, request, scoularId, customerId, batchId, now);

        var scopesStored = ApplyScopes(certification, request.Scopes, now, rejections);
        var itemsStored = ApplyItems(certification, request.Items, now, rejections);

        // Promote the audit row in the SAME save as the certification. Either both land or neither
        // does, so the row can never claim success for a write that did not happen — and if this
        // throws, the "Received" row stays, which is the signal.
        auditRow.Status = "Succeeded";
        auditRow.Accepted = 1;
        auditRow.Rejected = rejections.Count;
        auditRow.UnmatchedCustomer = customerId is null ? 1 : 0;
        auditRow.Message = $"scopes={scopesStored};items={itemsStored}";

        await _db.SaveChangesAsync(cancellationToken);

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

    /// <summary>
    /// Records a status transition before the incoming status overwrites the stored one.
    ///
    /// Must run BEFORE the assignment, and is the only chance to capture it — the feed sends
    /// current state only, so once OperationStatus is replaced the prior value is gone for good.
    ///
    /// Three rules, each of which matters:
    /// <list type="bullet">
    /// <item>A first sighting is NOT a change. A brand-new operation has nothing to have changed
    /// from, and reporting one would put a spurious flag on every producer the first night.</item>
    /// <item>An unchanged status leaves both fields ALONE. They mark the last real transition, not
    /// the last message — clearing them nightly would make the flag vanish the day after it
    /// appeared, which is precisely when the desk needs it.</item>
    /// <item>Comparison is trimmed and case-insensitive, so "Certified" and "certified " are the
    /// same status and do not manufacture a transition out of source formatting.</item>
    /// </list>
    /// A move to or from an empty status is deliberately not treated as a transition: "changed from
    /// nothing" is not actionable, and the source omitting a status is a data gap rather than a
    /// certification event.
    /// </summary>
    private static void CaptureStatusTransition(
        OrganicCertification target,
        string? incomingStatus,
        DateTime now)
    {
        var before = target.OperationStatus?.Trim();
        var after = incomingStatus?.Trim();

        if (string.IsNullOrEmpty(before) || string.IsNullOrEmpty(after)) return;
        if (string.Equals(before, after, StringComparison.OrdinalIgnoreCase)) return;

        target.PreviousStatus = before;
        target.StatusChangedOn = now;
    }

    private static void ApplyOperation(
        OrganicCertification target,
        OrganicCertificationIngestRequest source,
        string? scoularId,
        long? customerId,
        Guid batchId,
        DateTime now)
    {
        // Before anything overwrites OperationStatus.
        CaptureStatusTransition(target, source.Status, now);

        target.ScoularId = scoularId;
        target.CustomerId = customerId;
        target.OperationName = source.OperationName;
        target.OperationOtherNames = source.OperationOtherNames;
        target.ClientOperationId = source.ClientOperationId;
        target.CertifierName = source.CertifierName;
        target.OperationStatus = source.Status;
        target.StatusEffectiveDate = source.StatusEffectiveDate?.Date;
        target.AnniversaryDate = source.AnniversaryDate?.Date;
        target.SourceLastUpdateDate = source.LastUpdatedDate?.Date;
        target.TotalAcreage = source.TotalAcreage;

        // Presence in the feed is the active signal. Nothing here ever sets IsActive false.
        //
        // The sender began supplying a run id on 2026-10-07 and it is now recorded below, but that
        // is NOT on its own enough to deactivate on absence, and the gap is easy to miss: knowing
        // which producers a run touched says nothing about whether the run FINISHED. A pipeline
        // that sends 400 of 1,000 and dies would make 600 healthy producers look absent. Until
        // there is an end-of-run signal, deactivation stays driven by an explicit terminal status.
        target.IsActive = true;
        target.DeactivatedOn = null;

        target.UpdatedOn = now;
        target.LoadBatchId = batchId;

        // Last writer wins, deliberately: this says which run most recently touched the row, which
        // is exactly what "not seen since run X" will need. Null when the sender omits it — never
        // overwrite a real id with null, or a single legacy message would erase the history.
        var feedRunId = source.FeedRunId?.Trim();
        if (!string.IsNullOrEmpty(feedRunId)) target.LastFeedRunId = feedRunId;
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
        // ABSENT is not the same as EMPTY, and the difference is the whole cost of the
        // unknown-member Skip trade (Caden Egr, review 2026-09-24). Under Skip a property the
        // sender renames binds as null, indistinguishable from one they deliberately omitted —
        // so clearing here would turn a typo on their side into silent deletion of every stored
        // scope. Under the API-wide Disallow that same typo would have been a loud 400.
        //
        // So: an explicit empty array is a real statement ("this operation has none") and clears.
        // Absence is treated as no information, leaves the stored set alone, and is reported so
        // it cannot pass unnoticed.
        if (scopes is null)
        {
            rejections.Add(new OrganicCertificationRejection
            {
                Element = "scopes",
                Code = "SCOPES_ABSENT",
                Message = "No scopes property in the payload. Existing scopes were left unchanged; "
                        + "send an empty array to clear them.",
            });
            return certification.Scopes.Count;
        }

        certification.Scopes.Clear();
        if (scopes.Count == 0) return 0;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var scope in scopes)
        {
            var name = scope.Scope?.Trim();
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
                ScopeStatus = scope.Status,
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
        // Same absent-versus-empty rule as ApplyScopes — see the note there. It matters more here:
        // an empty items array is the NORMAL shape for a surrendered operation, so this path runs
        // legitimately and often, and must not be conflated with the sender renaming the property.
        if (items is null)
        {
            rejections.Add(new OrganicCertificationRejection
            {
                Element = "items",
                Code = "ITEMS_ABSENT",
                Message = "No items property in the payload. Existing items were left unchanged; "
                        + "send an empty array to clear them.",
            });
            return certification.Items.Count;
        }

        certification.Items.Clear();
        if (items.Count == 0) return 0;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            // An item must SAY something. Catalogued items carry an id and a name; free-text ones
            // carry neither and put everything in otherItems. Either is fine — but an item with
            // none of the three describes no crop at all and cannot be rendered.
            var describesSomething =
                item.ItemId is not null
                || !string.IsNullOrWhiteSpace(item.ItemName)
                || !string.IsNullOrWhiteSpace(item.OtherItems);

            if (!describesSomething)
            {
                rejections.Add(new OrganicCertificationRejection
                {
                    Element = "item",
                    Code = "EMPTY_ITEM",
                    Message = "Item carried no itemId, itemName or otherItems, so there is nothing "
                            + "to store or display.",
                });
                continue;
            }

            // Duplicate detection has to work for both shapes, so the key depends on which one this
            // is. A catalogue id, where present, IS the identity — the same id twice under one
            // scope is the sender contradicting itself, even if the names differ. Free-text items
            // have no id, so they fall back to their text.
            //
            // Scope is part of both keys deliberately: a producer certified for the same crop under
            // Crops and under Handling holds two genuine certifications, not a duplicate.
            var fingerprint = item.ItemId is not null
                ? $"id\u001f{item.Scope?.Trim()}\u001f{item.ItemId}"
                : $"text\u001f{item.Scope?.Trim()}\u001f{item.ItemName?.Trim()}\u001f{item.OtherItems?.Trim()}";

            if (!seen.Add(fingerprint))
            {
                rejections.Add(new OrganicCertificationRejection
                {
                    Element = "item",
                    Identifier = item.ItemName ?? item.ItemId?.ToString(),
                    Code = "DUPLICATE_ITEM",
                    Message = "An identical item appeared more than once in this message.",
                });
                continue;
            }

            certification.Items.Add(new OrganicCertificationItem
            {
                ItemId = item.ItemId,
                Scope = item.Scope,
                CertificateNumber = item.CertificateNumber,
                Status = item.Status,
                StatusEffectiveDate = item.StatusEffectiveDate?.Date,
                // Stored verbatim, both shapes. An item name that maps to no Scoular commodity is a
                // vocabulary mismatch, not bad data, and is resolved softly at read time.
                ItemName = item.ItemName,
                CategoryName = item.CategoryName,
                CategoryId = item.CategoryId,
                Varieties = item.Varieties,
                OtherItems = item.OtherItems,
                Organic = item.Organic ?? false,
                Organic100 = item.Organic100 ?? false,
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
        string? feedRunId,
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
            FeedRunId = feedRunId,
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
