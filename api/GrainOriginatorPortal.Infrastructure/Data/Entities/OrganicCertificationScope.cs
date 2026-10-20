using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One certification scope of an operation — CROPS, LIVESTOCK, WILD CROPS or HANDLING — each
/// carrying its own status and effective date.
///
/// This table exists because the operation-level status is not the whole picture: a producer can
/// be Certified for CROPS and Surrendered for HANDLING at the same time. Anything that answers
/// "can we trade this commodity with them" has to read scope status, not just
/// OrganicCertification.OperationStatus.
///
/// Replaced as a set on ingest, keyed on (certification, scope).
/// </summary>
public class OrganicCertificationScope
{
    public int Id { get; set; }
    public int OrganicCertificationId { get; set; }

    /// <summary>Source vocabulary, e.g. "CROPS". Stored as sent.</summary>
    public string Scope { get; set; } = string.Empty;

    /// <summary>Status for this scope alone. May differ from the operation-level status.</summary>
    public string? ScopeStatus { get; set; }

    public DateTime? StatusEffectiveDate { get; set; }

    public DateTime UpdatedOn { get; set; }

    [JsonIgnore]
    public OrganicCertification? OrganicCertification { get; set; }
}
