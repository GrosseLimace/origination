using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// A producer the sender considered in a nightly run but deliberately did NOT send a certification
/// for.
///
/// ── Why this exists at all ──
/// The run total counts every producer considered, not the ones successfully sent, because the
/// sender only discovers mid-run that a producer has no USDA record — 23 of 839 in the Dev load.
/// Without a notice, a deliberate skip and a message lost in transit look identical: both are a
/// missing position. That ambiguity is what stops us ever acting on absence, because a run that
/// skipped 50 producers would be indistinguishable from one that died 50 short.
///
/// A skip fills its position, so "we hold RunTotal distinct positions for this run" means the run
/// finished, while a genuine failure still leaves a gap until it is re-sent.
///
/// ── Why a separate endpoint, not a flag on ingest ──
/// <see cref="Reason"/> can be INELIGIBLE_NOP, meaning the NOP id is blank or a placeholder in
/// master data. The ingest endpoint rejects exactly that with MISSING_NOP_OPERATION_ID — the one
/// failure that loses a whole message, because without a NOP id there is no key to store under.
/// Routing skips through ingest would mean relaxing the strictest validation we have.
///
/// ── The unknown-member opt-out ──
/// Same reasoning as <see cref="OrganicCertificationIngestRequest"/>: the API-wide
/// JsonUnmappedMemberHandling.Disallow is right for anything a user posts, but here a single new
/// field on the sender's side would make every message 400 until we shipped a matching DTO. Nothing
/// binds to an EF entity; the service copies field by field.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public record OrganicCertificationSkipRequest
{
    /// <summary>
    /// The Scoular customer code. <b>Required, and the only identifier guaranteed present.</b>
    ///
    /// This is why it is required rather than the NOP id: on an INELIGIBLE_NOP skip the NOP id is
    /// blank by definition, so without the customer code the row would tie back to nobody and the
    /// notice would say nothing useful.
    /// </summary>
    [Required]
    [StringLength(50, MinimumLength = 1)]
    public required string ScoularId { get; init; }

    /// <summary>The NOP id, when master data holds one. Null or blank is normal and expected —
    /// that is precisely what INELIGIBLE_NOP describes.</summary>
    [StringLength(50)]
    public string? NopOperationId { get; init; }

    /// <summary>
    /// Why the producer was skipped. Known values today are NOT_IN_USDA (master data holds a NOP id
    /// but USDA has no operation for it) and INELIGIBLE_NOP (the NOP id is blank or a placeholder).
    ///
    /// Deliberately a string, not an enum: it is the sender's vocabulary, and an unrecognised reason
    /// must be recorded and shown rather than rejected. Rejecting one would turn a new reason code
    /// into a permanent gap in the run — the exact failure this endpoint exists to prevent.
    /// </summary>
    [Required]
    [StringLength(50, MinimumLength = 1)]
    public required string Reason { get; init; }

    /// <summary>Shared by every message in one nightly run, ingest and skip alike. Null on a
    /// one-off intraday notice, which carries no run context.</summary>
    [StringLength(100)]
    public string? FeedRunId { get; init; }

    /// <summary>This producer's position in the run, 1..<see cref="RunTotal"/>.</summary>
    [Range(1, int.MaxValue)]
    public int? RunPosition { get; init; }

    /// <summary>How many producers the run considered. Constant across the whole run.</summary>
    [Range(1, int.MaxValue)]
    public int? RunTotal { get; init; }
}
