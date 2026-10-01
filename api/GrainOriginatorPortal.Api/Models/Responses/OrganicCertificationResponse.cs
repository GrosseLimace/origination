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
