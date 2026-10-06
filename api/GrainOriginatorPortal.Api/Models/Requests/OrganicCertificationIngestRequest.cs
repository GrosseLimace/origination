using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// One producer's NOP certification, as posted by the integration. The feed sends one message per
/// producer rather than a batch, so this is a single operation and its children.
///
/// ── Shape ──
/// Rebuilt 2026-09-29 against two captured messages. An earlier version nested the operation fields
/// under an "operation" object; the real payload is FLAT — scoularId sits alongside nopOperationId,
/// operationName, status and the rest. It also carries contact, activities and addresses blocks that
/// are deliberately not modelled here (see below).
///
/// ── Why these types opt out of the global unknown-member rule ──
/// Program.cs sets JsonUnmappedMemberHandling.Disallow for the whole API, deliberately, as
/// mass-assignment hardening (security-guide.md §4.1). That default is right for anything a user
/// posts, but wrong here: this payload is produced by a third party from USDA data, and a single
/// new field on their side would make every nightly message 400 until we shipped a matching DTO.
///
/// Skip is safe in this specific shape because the hardening exists to stop a caller setting
/// properties they should not — and nothing here binds to an EF entity. These are inert records;
/// the service copies field by field, so an unknown member is dropped rather than assigned. Do NOT
/// copy this attribute onto a request that binds to a persistence type.
///
/// The cost of that trade is real and is documented in STYLE-DEVIATIONS.md: a field WE misname is
/// silently ignored rather than rejected. OrganicCertificationPayloadContractTests pins the names
/// against the captured samples, and is what caught the first version being wrong in seven places.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicCertificationIngestRequest
{
    /// <summary>Scoular customer code — the CTRM CustID, matched against Customer.ScoularId.
    /// Required, but a value matching no customer is accepted and counted, not rejected.</summary>
    [Required]
    [StringLength(50)]
    public required string ScoularId { get; init; }

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

    /// <summary>Includes the bracketed short code, e.g. "[MCIA] Minnesota Crop Improvement
    /// Association".</summary>
    [StringLength(255)]
    public string? CertifierName { get; init; }

    /// <summary>Certified / Surrendered / Suspended / Revoked. Deliberately a string, not an enum:
    /// it is third-party vocabulary and an unrecognised value must be stored and shown, not
    /// rejected.</summary>
    [StringLength(50)]
    public string? Status { get; init; }

    /// <summary>When the current status began. Backward-looking.</summary>
    public DateTime? StatusEffectiveDate { get; init; }

    /// <summary>The NEXT scheduled annual update — forward-looking, and absent on roughly 15% of
    /// real records. Not an expiry date; NOP certification has none.</summary>
    public DateTime? AnniversaryDate { get; init; }

    /// <summary>The certifier's record-freshness stamp. Note the spelling — "Updated", not
    /// "Update"; an earlier version had it wrong and it bound as null.</summary>
    public DateTime? LastUpdatedDate { get; init; }

    [Range(0, 100_000_000)]
    public decimal? TotalAcreage { get; init; }

    /// <summary>Crops / Livestock / Wild Crops / Handling, each with its own status. Title case in
    /// the source; all comparisons here are case-insensitive.</summary>
    public IReadOnlyList<OrganicScopeDto>? Scopes { get; init; }

    /// <summary>The certified crops and products. Empty for a surrendered operation — that is
    /// expected, not an error.</summary>
    public IReadOnlyList<OrganicItemDto>? Items { get; init; }

    // Deliberately NOT modelled, and ignored by the Skip attribute above:
    //
    //   contact    — firstName, lastName, phone, email, websiteUrl. Contact PII we do not store;
    //                binding it would put it in memory and in validation errors for no benefit,
    //                and would oblige the read endpoint to be trade-unit scoped as ProducerDetails
    //                is. See MigrationSnapshotConsistencyTests.CertificationDoesNotStoreContactPii.
    //   activities — broker, distributor, growerGroup, marketerTrader, privateLabeler, dairy.
    //                Available; nothing displays them.
    //   addresses  — we already hold customer addresses. Could help verify the shared-NOPID cases
    //                one day, but speculative until asked for.
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicScopeDto
{
    /// <summary>"Crops", "Livestock", "Handling", "Wild Crops".</summary>
    [Required]
    [StringLength(50, MinimumLength = 1)]
    public required string Scope { get; init; }

    /// <summary>Status for this scope alone. May differ from the operation-level status — a
    /// producer can be Certified for Crops and Surrendered for Handling at the same time.</summary>
    [StringLength(50)]
    public string? Status { get; init; }

    public DateTime? StatusEffectiveDate { get; init; }
}

/// <summary>
/// One certified item. Comes in TWO shapes, and both are normal:
///
/// <list type="bullet">
/// <item><b>Catalogued</b> — <see cref="ItemId"/>, <see cref="ItemName"/>, <see cref="CategoryId"/>
/// and <see cref="CategoryName"/> populated from USDA's item catalogue, <see cref="OtherItems"/>
/// null. Example: itemId 377, "Sugercane", category 2 "Field/Forageable".</item>
/// <item><b>Free text</b> — all four of those null, with the content in <see cref="OtherItems"/>.
/// Example: "Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Rye/Sorghum, Soybeans, Wheat/Alfalfa".</item>
/// </list>
///
/// Whole operations arrive in the free-text shape — one of the two captured samples has no
/// catalogued items at all. So ItemId is NOT a usable key and is not required: an earlier version
/// demanded it, which would have rejected every crop that producer holds and stored a certified
/// operation with nothing certified.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicItemDto
{
    /// <summary>USDA catalogue item id. Numeric, and null on free-text items.</summary>
    public int? ItemId { get; init; }

    /// <summary>Which scope this item falls under.</summary>
    [StringLength(50)]
    public string? Scope { get; init; }

    /// <summary>Repeats across every item on the same certificate; null on some operations.</summary>
    [StringLength(100)]
    public string? CertificateNumber { get; init; }

    [StringLength(50)]
    public string? Status { get; init; }

    public DateTime? StatusEffectiveDate { get; init; }

    /// <summary>The crop or product from USDA's catalogue. Null on free-text items — read
    /// <see cref="OtherItems"/> in that case.</summary>
    [StringLength(255)]
    public string? ItemName { get; init; }

    [StringLength(255)]
    public string? CategoryName { get; init; }

    /// <summary>USDA catalogue category id. Numeric, and null on free-text items.</summary>
    public int? CategoryId { get; init; }

    [StringLength(1000)]
    public string? Varieties { get; init; }

    /// <summary>Free-text contents where the certifier did not use the catalogue. Not always a
    /// list — one captured sample reads "Carryover Crops of: 2024 Soybeans - 4000 bushels and 2024
    /// Corn - 5000 bushels", so do not assume it splits on commas.</summary>
    [StringLength(2000)]
    public string? OtherItems { get; init; }

    /// <summary>Tri-state in the source: true, or null meaning "not this tier". The two tiers are
    /// used exclusively of each other in both captured samples.</summary>
    public bool? Organic { get; init; }

    public bool? Organic100 { get; init; }
}
