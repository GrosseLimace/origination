using System.Text.Json.Serialization;
using GrainOriginatorPortal.Infrastructure.Json;

namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Organic certification for one producer, as the profile panel needs it.
///
/// Returns a record for ANY producer, never a 404 — the same semantics as
/// <c>GET /api/producerdetails/customer/{id}</c>. A producer with no NOP id and a producer with a
/// NOP id but no certification are different states, and both have to be renderable.
/// </summary>
public record CustomerOrganicCertificationResponse
{
    public long CustomerId { get; init; }

    /// <summary>The producer's NOP id from dbo.Customer, already normalised. Null means none on
    /// file.</summary>
    public string? Nopid { get; init; }

    /// <summary>
    /// True when a NOP id is on file but the feed has sent us no certification for it.
    ///
    /// This is a state the organics desk asked to see explicitly, not an error: show the NOP id as
    /// usual and warn alongside it. It means either the producer holds no current certificate — the
    /// sender filters out operations with none — or the feed has not reached us for them yet.
    /// Either is worth a trader knowing before they trade.
    /// </summary>
    public bool NoCertificateOnFile { get; init; }

    /// <summary>Null when there is no NOP id, or none has been received for it.</summary>
    public OrganicCertificationResponse? Certification { get; init; }
}

public record OrganicCertificationResponse
{
    public string Nopid { get; init; } = string.Empty;
    public string? OperationName { get; init; }

    /// <summary>Includes the bracketed short code as the source sends it, e.g. "[MCIA] Minnesota
    /// Crop Improvement Association".</summary>
    public string? CertifierName { get; init; }

    /// <summary>Operation-level status. Not the whole picture — read <see cref="Scopes"/> for what
    /// a producer may actually trade.</summary>
    public string? Status { get; init; }

    public bool IsCertified { get; init; }

    /// <summary>When the current status began, per the certifier. This is the date to DISPLAY.</summary>
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? StatusEffectiveDate { get; init; }

    /// <summary>The NEXT scheduled annual update — forward-looking, and frequently absent. NOT an
    /// expiry date: NOP certification has none.</summary>
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? AnniversaryDate { get; init; }

    public decimal? TotalAcreage { get; init; }

    // ── Record currency ────────────────────────────────────────────────────────────────────────
    /// <summary>
    /// When the certifier last touched this operation's profile — the "updated on" date shown at
    /// the top of the USDA Organic Integrity profile page.
    ///
    /// Named for what it IS, not what it is used for. It records that the PROFILE changed, which is
    /// not the same as a certificate being issued — a profile is also updated for a name or address
    /// change. The organics desk chose it (Madeline Tatum, 2026-10-01) because no certificate issue
    /// date exists in any queryable form; it lives only on the printed PDF.
    /// </summary>
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? SourceUpdatedOn { get; init; }

    /// <summary>
    /// True when <see cref="SourceUpdatedOn"/> is older than the compliance window (18 months by
    /// default, configurable), or when there is no date at all.
    ///
    /// This is the desk's standing requirement — their certifier expects documentation current
    /// within 18 months — expressed against the only date we can actually read. Absent counts as
    /// outside the window: we cannot show a trader "current" on the strength of a missing date.
    /// </summary>
    public bool OutsideComplianceWindow { get; init; }

    /// <summary>Whole months since the certifier last touched the profile. Null when unknown — the
    /// panel should say "unknown" rather than imply zero.</summary>
    public int? MonthsSinceSourceUpdate { get; init; }

    // ── Status change ──────────────────────────────────────────────────────────────────────────
    /// <summary>Whether a status change should still be flagged. Computed server-side from the
    /// shared rule so the profile and Actionable Insights cannot disagree: flagged from the moment
    /// a change is seen until the status returns to Certified.</summary>
    public bool HasUnresolvedStatusChange { get; init; }

    /// <summary>What it changed FROM. Null when nothing has changed on our watch.</summary>
    public string? PreviousStatus { get; init; }

    /// <summary>When our feed observed the change — distinct from <see cref="StatusEffectiveDate"/>,
    /// which is the certifier's date and the one to show.</summary>
    public DateTime? StatusChangedOn { get; init; }

    /// <summary>Per scope, because a producer can be Certified for Crops and Surrendered for
    /// Handling at once. Crops are grouped under the scope that certifies them.</summary>
    public List<OrganicCertificationScopeResponse> Scopes { get; init; } = [];

    /// <summary>Our watermark — when this application last wrote the row (UTC).</summary>
    public DateTime UpdatedOn { get; init; }
}

/// <summary>
/// A producer whose certification status has changed and has not resolved back to Certified.
///
/// Deliberately a BULK read returning only the flagged producers, because Actionable Insights
/// computes client-side over preloaded data and makes no per-customer calls. The set is small by
/// construction — only producers whose certification actually moved — so this stays a cheap call
/// rather than an enrichment over thousands of customer rows.
///
/// One NOP id can cover several customer records, so one changed certification can yield several
/// rows here. That is correct: Insights is keyed by customer, and each affected producer needs its
/// own alert.
/// </summary>
public record OrganicCertificationStatusChangeResponse
{
    public long CustomerId { get; init; }

    /// <summary>The CTRM customer code. This is what the client matches on — Actionable Insights
    /// indexes contracts by it.</summary>
    public string? ScoularId { get; init; }

    public string Nopid { get; init; } = string.Empty;
    public string? OperationName { get; init; }

    /// <summary>The status now.</summary>
    public string? Status { get; init; }

    /// <summary>What it changed FROM.</summary>
    public string? PreviousStatus { get; init; }

    /// <summary>When the certifier says the new status took effect — the date to display.</summary>
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? StatusEffectiveDate { get; init; }

    /// <summary>When our feed observed the change. Drives "changed recently", not display.</summary>
    public DateTime? StatusChangedOn { get; init; }
}

/// <summary>One certification scope and the crops certified under it.</summary>
public record OrganicCertificationScopeResponse
{
    /// <summary>"Crops", "Livestock", "Handling", "Wild Crops".</summary>
    public string Scope { get; init; } = string.Empty;

    public string? Status { get; init; }

    /// <summary>Whether THIS scope is certified. The question a trader is actually asking.</summary>
    public bool IsCertified { get; init; }

    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? StatusEffectiveDate { get; init; }

    /// <summary>
    /// Crops certified under this scope, already split and de-duplicated server-side so the client
    /// renders chips without parsing anything.
    ///
    /// Catalogued items contribute their name directly; free-text items are split on list
    /// punctuation. Entries a certifier wrote as prose may read oddly — that is preferred to
    /// hiding a crop a trader is searching for.
    /// </summary>
    public List<string> Crops { get; init; } = [];
}
