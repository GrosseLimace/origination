using System.Text.Json;

namespace GrainOriginatorPortal.Api.Models.Responses;

// The shapes match client/src/app/models/field-plan.model.ts exactly, so the client's FieldPlanStore takes
// them as they come. Program data, frozen estimates, attestations and snapshots are passed through as JSON.

/// <summary>Everything one producer has in the field plan, across all years.</summary>
public record FieldPlanSnapshotResponse
{
    public required IReadOnlyList<ProducerFieldResponse> Fields { get; init; }
    public required IReadOnlyList<FieldSeasonResponse> Seasons { get; init; }
    public required IReadOnlyList<FieldProgramRecordResponse> Records { get; init; }
    public required IReadOnlyList<ProgramEnrollmentResponse> Enrollments { get; init; }
}

/// <summary>A producer's field: one CTRM split.</summary>
public record ProducerFieldResponse
{
    /// <summary>The split ID.</summary>
    public required string FieldKey { get; init; }
    public required string SplitId { get; init; }
    public required long CustomerId { get; init; }
    public required string Name { get; init; }
    public required decimal SplitPercent { get; init; }
    /// <summary>yyyy-MM-dd, or "" when CTRM had none.</summary>
    public required string EffectiveDate { get; init; }
    /// <summary>"" until entered.</summary>
    public required string State { get; init; }
    public required string County { get; init; }
}

public record FieldSeasonResponse
{
    public required string Id { get; init; }
    public required string FieldKey { get; init; }
    public required int PlantingIntentionId { get; init; }
    public required int Year { get; init; }
    public required string CropLabel { get; init; }
    public decimal? Acres { get; init; }
}

public record FieldProgramRecordResponse
{
    public required string Id { get; init; }
    public required string SeasonId { get; init; }
    public required string ProgramKey { get; init; }
    public required JsonElement Data { get; init; }
    /// <summary>Draft, Ready or Locked.</summary>
    public required string Status { get; init; }
    public int? CopiedFromYear { get; init; }
    public string? CopiedFromField { get; init; }
    /// <summary>The locked harvest estimate (always basis "Estimate"); null unless Locked.</summary>
    public JsonElement? Frozen { get; init; }
    /// <summary>Placeholder for an official result; nothing writes it yet.</summary>
    public JsonElement? Official { get; init; }
    public JsonElement? Reopened { get; init; }
}

public record ProgramEnrollmentResponse
{
    public required string Key { get; init; }
    public required string ProgramKey { get; init; }
    public required long CustomerId { get; init; }
    public required int Year { get; init; }
    /// <summary>Open, Attested or Withdrawn.</summary>
    public required string Status { get; init; }
    public required JsonElement Attestation { get; init; }
    public string? AttestedBy { get; init; }
    public DateTime? AttestedAt { get; init; }
    public JsonElement? Snapshot { get; init; }
    public DateTime? HarvestCompleteAt { get; init; }
    public string? WithdrawnReason { get; init; }
}

/// <summary>An unlocked record, and its enrollment when unlocking reopened the enrollment's harvest.</summary>
public record FieldPlanReopenResponse
{
    public required FieldProgramRecordResponse Record { get; init; }
    public ProgramEnrollmentResponse? Enrollment { get; init; }
}
