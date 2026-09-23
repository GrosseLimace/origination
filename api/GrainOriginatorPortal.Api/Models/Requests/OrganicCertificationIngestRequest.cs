using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// One producer's NOP certification, as posted by the integration. The feed sends one message per
/// producer rather than a batch, so this is a single operation and its children — see
/// OrganicCertificationIngestResponse for why the response reports one outcome rather than counts.
///
/// ── Why these types opt out of the global unknown-member rule ──
/// Program.cs sets JsonUnmappedMemberHandling.Disallow for the whole API, deliberately, as
/// mass-assignment hardening (security-guide.md §4.1). That default is right for anything a user
/// posts, but wrong here: this payload is produced by a third party from USDA data, and a single
/// new field on their side would make every nightly message 400 until we shipped a matching DTO.
/// A feed that fails closed on a harmless addition is worse than one that ignores it.
///
/// Skip is safe in this specific shape because the hardening exists to stop a caller setting
/// properties they should not — and nothing here binds to an EF entity. These are inert records;
/// the service copies field by field into the entity, so an unknown member is dropped rather than
/// assigned. Do NOT copy this attribute onto a request that binds to a persistence type.
///
/// This is also where we diverge from the BarChart ingest endpoint, which takes a raw string body
/// for the same reason and therefore gets no validation, no OpenAPI schema and no model binding.
/// Skip keeps all three.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicCertificationIngestRequest
{
    /// <summary>Scoular customer code — the CTRM CustID, matched against Customer.ScoularId.
    /// Required, but a value matching no customer is accepted and counted, not rejected.</summary>
    [Required]
    [StringLength(50)]
    public required string ScoularId { get; init; }

    [Required]
    public required OrganicOperationDto Operation { get; init; }

    /// <summary>CROPS / LIVESTOCK / WILD CROPS / HANDLING, each with its own status.</summary>
    public IReadOnlyList<OrganicScopeDto>? Scopes { get; init; }

    /// <summary>The certified crops and products. Empty for a surrendered operation — that is
    /// expected, not an error.</summary>
    public IReadOnlyList<OrganicItemDto>? Items { get; init; }
}

/// <summary>
/// The certified operation. Contact fields present in the source payload (contactFirstName,
/// contactLastName, phone, email) are deliberately absent here as well as from the database:
/// binding PII we do not store would put it in memory and in logs on a validation failure for no
/// benefit. Unknown-member Skip means their presence in the payload is simply ignored.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicOperationDto
{
    /// <summary>USDA NOP operation id. The upsert key.</summary>
    [Required]
    [StringLength(50, MinimumLength = 1)]
    public required string NopOperationId { get; init; }

    [StringLength(255)]
    public string? OperationName { get; init; }

    [StringLength(500)]
    public string? OperationOtherNames { get; init; }

    [StringLength(100)]
    public string? ClientOperationId { get; init; }

    [StringLength(255)]
    public string? CertifierName { get; init; }

    /// <summary>Certified / Surrendered / Suspended / Revoked. Deliberately a string, not an enum:
    /// it is third-party vocabulary and an unrecognised value must be stored and shown, not
    /// rejected.</summary>
    [StringLength(50)]
    public string? NopOperationStatus { get; init; }

    /// <summary>When the current status began. Backward-looking.</summary>
    public DateTime? StatusEffectiveDate { get; init; }

    /// <summary>The NEXT scheduled annual update — forward-looking, and absent on roughly 15% of
    /// real records. Not an expiry date; NOP certification has none.</summary>
    public DateTime? NopAnniversaryDate { get; init; }

    public DateTime? LastUpdateDate { get; init; }

    public bool? HasCertificate { get; init; }

    [StringLength(500)]
    [Url]
    public string? CertificateUrl { get; init; }

    [Range(0, 100_000_000)]
    public decimal? TotalAcreage { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicScopeDto
{
    [Required]
    [StringLength(50, MinimumLength = 1)]
    public required string NopScope { get; init; }

    [StringLength(50)]
    public string? ScopeStatus { get; init; }

    public DateTime? StatusEffectiveDate { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicItemDto
{
    /// <summary>The certifier's item identifier, unique within the operation. The upsert key for
    /// this child.</summary>
    [Required]
    [StringLength(100, MinimumLength = 1)]
    public required string ItemId { get; init; }

    [StringLength(50)]
    public string? NopScope { get; init; }

    [StringLength(100)]
    public string? CertificateNumber { get; init; }

    [StringLength(50)]
    public string? Status { get; init; }

    public DateTime? StatusEffectiveDate { get; init; }

    /// <summary>The crop or product in the certifier's own wording — "Corn", "Cleaned and bagged
    /// grain". Stored verbatim; not mapped to a Scoular commodity on the way in.</summary>
    [StringLength(255)]
    public string? ItemName { get; init; }

    [StringLength(255)]
    public string? CategoryName { get; init; }

    [StringLength(50)]
    public string? CategoryId { get; init; }

    [StringLength(1000)]
    public string? ItemVarieties { get; init; }

    [StringLength(1000)]
    public string? OtherItems { get; init; }

    public bool? Organic { get; init; }

    public bool? Organic100 { get; init; }

    public bool? MadeWithOrganic { get; init; }
}
