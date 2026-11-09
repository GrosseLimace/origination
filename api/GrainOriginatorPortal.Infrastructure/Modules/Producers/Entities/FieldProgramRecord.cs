using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

/// <summary>
/// One field season's inputs for one sustainability program (45Z today). Program inputs differ by
/// program and by USDA version, so they are JSON (<see cref="Data"/>), like Note.Mentions. Confirming a 45Z
/// field after harvest locks it: the CI is frozen (<see cref="Frozen"/>) and the confirmed CI is the <see cref="Official"/> result.
/// A locked record is never changed or removed until it is unlocked with a reason (kept in <see cref="Reopened"/>).
/// </summary>
public class FieldProgramRecord
{
    public int Id { get; set; }
    public int ProducerFieldSeasonId { get; set; }
    /// <summary>"45z-fdcic" (45Z, the only approved program).</summary>
    public string ProgramKey { get; set; } = string.Empty;
    /// <summary>Draft, Ready or Locked.</summary>
    public string Status { get; set; } = "Draft";
    public string Data { get; set; } = "{}";
    public int? CopiedFromYear { get; set; }
    public string? CopiedFromField { get; set; }
    /// <summary>JSON: the locked estimate's inputs, outputs, score and calculator version. Null unless Locked.</summary>
    public string? Frozen { get; set; }
    public string? LockedBy { get; set; }
    public DateTime? LockedAt { get; set; }
    /// <summary>JSON array: each unlock's reason, time, and the frozen CI and confirmed result it unlocked.</summary>
    public string? Reopened { get; set; }
    /// <summary>JSON: the confirmed CI (status Documented) with its bushels, tickets and who confirmed it; written by confirming.</summary>
    public string? Official { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }

    [JsonIgnore]
    public ProducerFieldSeason? Season { get; set; }
}
