using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Adds one of the producer's CTRM splits as a field. Name, split % and effective date come from CTRM, not the request.</summary>
public record CreateProducerFieldRequest
{
    [Range(1, long.MaxValue)]
    public required long CustomerId { get; init; }

    [Required, StringLength(20, MinimumLength = 1)]
    public required string SplitId { get; init; }

    [StringLength(2)]
    public string? State { get; init; }

    [StringLength(100)]
    public string? County { get; init; }
}

/// <summary>A field's location: the only part of a field the app edits.</summary>
public record UpdateProducerFieldRequest
{
    [StringLength(2)]
    public string? State { get; init; }

    [StringLength(100)]
    public string? County { get; init; }
}

public record CreateFieldSeasonRequest
{
    [Required, StringLength(20, MinimumLength = 1)]
    public required string FieldKey { get; init; }

    [Range(1, int.MaxValue)]
    public required int PlantingIntentionId { get; init; }

    [Range(2000, 2100)]
    public required int Year { get; init; }

    [Required, StringLength(100, MinimumLength = 1)]
    public required string CropLabel { get; init; }

    [Range(0, 1_000_000)]
    public decimal? Acres { get; init; }
}

/// <summary>A season's acres: the only part of a season that changes after it's added.</summary>
public record UpdateFieldSeasonRequest
{
    [Range(0, 1_000_000)]
    public decimal? Acres { get; init; }
}

public record CreateFieldProgramRecordRequest
{
    [Required, StringLength(20, MinimumLength = 1)]
    public required string SeasonId { get; init; }

    [Required, StringLength(30, MinimumLength = 1)]
    public required string ProgramKey { get; init; }

    /// <summary>The program's inputs (blank, or carried forward from last year).</summary>
    public required JsonElement Data { get; init; }

    [Range(2000, 2100)]
    public int? CopiedFromYear { get; init; }
}

/// <summary>Saves a record's inputs. Draft/Ready is worked out by the server; locking is its own call.</summary>
public record UpdateFieldProgramRecordRequest
{
    public required JsonElement Data { get; init; }

    /// <summary>Set when the inputs were copied from another field this year.</summary>
    [StringLength(255)]
    public string? CopiedFromField { get; init; }
}

public record FieldPlanReasonRequest
{
    [Required, StringLength(500, MinimumLength = 1)]
    public required string Reason { get; init; }
}

public record EnsureProgramEnrollmentRequest
{
    [Required, StringLength(30, MinimumLength = 1)]
    public required string ProgramKey { get; init; }

    [Range(1, long.MaxValue)]
    public required long CustomerId { get; init; }

    [Range(2000, 2100)]
    public required int Year { get; init; }
}

/// <summary>The producer's signed attestation, as the client's ProgramAttestation.</summary>
public record ProgramAttestationDto
{
    [StringLength(200)]
    public required string SignerName { get; init; }

    /// <summary>yyyy-MM-dd, or "" until signed.</summary>
    [StringLength(10)]
    public required string SignedOn { get; init; }

    [RegularExpression("^(eSign|Paper)$")]
    public required string Method { get; init; }

    [StringLength(200)]
    public required string DocumentRef { get; init; }

    public required Dictionary<string, bool> Confirmations { get; init; }
}

public record UpdateAttestationRequest
{
    [Required]
    public required ProgramAttestationDto Attestation { get; init; }
}

/// <summary>
/// Attests an enrollment. <see cref="Listed"/> is the client's list of the producer's records in the program
/// that year (EnrollableRecord, kept as the snapshot); the server checks it against its own records.
/// </summary>
public record AttestEnrollmentRequest
{
    [Required, MaxLength(500)]
    public required List<JsonElement> Listed { get; init; }
}

public record HarvestCompleteRequest
{
    public required bool Complete { get; init; }
}
