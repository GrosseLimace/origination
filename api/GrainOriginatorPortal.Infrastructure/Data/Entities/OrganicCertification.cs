using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A USDA National Organic Program certified operation, as supplied by the certification feed.
/// One row per NOP id. Landing table for an integration we do NOT write from directly — the
/// external pipeline POSTs to our ingest endpoint and this application does the writing, which
/// keeps it the only writer to its own database.
///
/// Certification joins to a producer by NOP id, not by customer: Customer.NopIdNumber =
/// OrganicCertification.Nopid. A single NOP id legitimately covers several customer records
/// (family operations, a person and their LLC), and all of them read this one row. That is why
/// there is no junction table and why the display question "one operation or several?" does not
/// affect storage.
///
/// There is deliberately no expiry column. NOP certification continues in effect until
/// surrendered, suspended or revoked (7 CFR 205.404(d)); USDA INTEGRITY has no expiration field
/// and declined to add one. Recency is expressed by AnniversaryDate, which looks FORWARD to the
/// next scheduled annual update -- it is not a "last renewed" date, and roughly 15% of real
/// records do not carry one at all.
///
/// Contact details (name, phone, email) are present in the source payload and are deliberately
/// NOT stored: nothing displays them, and carrying contact PII here would oblige the read
/// endpoint to be trade-unit scoped, as ProducerDetails is.
/// </summary>
public class OrganicCertification
{
    public int Id { get; set; }

    /// <summary>USDA NOP operation id. The upsert key — unique, and what producers join on.</summary>
    public string Nopid { get; set; } = string.Empty;

    /// <summary>Scoular customer code as sent by the feed. Kept for the ingest report and for
    /// re-resolution if CustomerId could not be matched; NOT the display join.</summary>
    public string? ScoularId { get; set; }

    /// <summary>Resolved at ingest from ScoularId. Nullable on purpose: a NOP id for a producer we
    /// have not onboarded is stored and counted rather than rejected, so an onboarding gap never
    /// looks like a feed failure.</summary>
    public long? CustomerId { get; set; }

    public string? OperationName { get; set; }
    public string? OperationOtherNames { get; set; }

    /// <summary>The certifier's own reference for this operation.</summary>
    public string? ClientOperationId { get; set; }
    public string? CertifierName { get; set; }

    /// <summary>Certified / Surrendered / Suspended / Revoked. Held as the source's own string
    /// rather than an enum — it is third-party vocabulary and an unexpected value must not throw.</summary>
    public string? OperationStatus { get; set; }

    /// <summary>When the current status began — the "certified since" date. Backward-looking.
    /// This is the certifier's own date and is what the profile should DISPLAY.</summary>
    public DateTime? StatusEffectiveDate { get; set; }

    /// <summary>
    /// The status this operation held before the current one, captured at ingest when an incoming
    /// message disagrees with what we hold.
    ///
    /// Required because the feed only ever sends CURRENT state: the moment ingest overwrites
    /// OperationStatus the prior value is gone, and no re-request brings it back. The organics desk
    /// asked to see not just that a status changed but what it changed FROM, which is unanswerable
    /// without capturing it as it happens.
    ///
    /// Null on a record we have never seen before — a first sighting is not a change.
    /// </summary>
    public string? PreviousStatus { get; set; }

    /// <summary>
    /// When WE observed the status change (UTC). Deliberately distinct from
    /// <see cref="StatusEffectiveDate"/>, which is when the certifier says the new status took
    /// effect — the two answer different questions and both are wanted.
    ///
    /// Display uses the effective date ("Surrendered on 3 Aug"). This one drives the
    /// "changed recently" signal, because the desk wants changes picked up on the day the feed
    /// brings them in, regardless of how far back the certifier dated them.
    ///
    /// Retained across later ingests that carry the same status — it marks the last actual change,
    /// not the last message.
    /// </summary>
    public DateTime? StatusChangedOn { get; set; }

    /// <summary>When the NEXT annual update is due. Forward-looking, and frequently null.</summary>
    public DateTime? AnniversaryDate { get; set; }

    /// <summary>The certifier's own record-freshness stamp, not ours.</summary>
    public DateTime? SourceLastUpdateDate { get; set; }

    public bool HasCertificate { get; set; }

    /// <summary>Public USDA INTEGRITY link to the certificate.</summary>
    public string? CertificateUrl { get; set; }
    public decimal? TotalAcreage { get; set; }

    /// <summary>False once the operation stops appearing in the feed or is explicitly withdrawn.
    /// See DeactivatedOn.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime? DeactivatedOn { get; set; }

    /// <summary>Our watermark — when this application last wrote the row (UTC).</summary>
    public DateTime UpdatedOn { get; set; }

    /// <summary>Correlates the row with the OrganicCertificationLoad audit entry that wrote it.</summary>
    public Guid? LoadBatchId { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }

    public ICollection<OrganicCertificationScope> Scopes { get; set; } = new List<OrganicCertificationScope>();
    public ICollection<OrganicCertificationItem> Items { get; set; } = new List<OrganicCertificationItem>();
}
