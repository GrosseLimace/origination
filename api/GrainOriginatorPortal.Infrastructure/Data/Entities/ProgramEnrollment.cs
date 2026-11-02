using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A producer in one sustainability program for one crop year: the attestation and withdrawal
/// (HarvestCompleteAt is unused since 2026-10-30: each field is confirmed on its own). At most one live (Open or Attested) row per producer, program and year; withdrawn rows are
/// kept as history and re-enrolling adds a new row. Each field's enrollment ID is derived
/// (CI-{crop year}-{split ID}), not stored.
/// </summary>
public class ProgramEnrollment
{
    public int Id { get; set; }
    /// <summary>The ID the app uses.</summary>
    public Guid EnrollmentKey { get; set; }
    public long CustomerId { get; set; }
    public string ProgramKey { get; set; } = string.Empty;
    public int CropYear { get; set; }
    /// <summary>Open, Attested or Withdrawn.</summary>
    public string Status { get; set; } = "Open";
    /// <summary>JSON: signer, date signed, eSign/paper, document reference, confirmations.</summary>
    public string Attestation { get; set; } = "{}";
    public string? AttestedBy { get; set; }
    public DateTime? AttestedAt { get; set; }
    /// <summary>JSON array: the fields listed when the producer attested.</summary>
    public string? Snapshot { get; set; }
    public DateTime? HarvestCompleteAt { get; set; }
    public string? WithdrawnReason { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }
}
