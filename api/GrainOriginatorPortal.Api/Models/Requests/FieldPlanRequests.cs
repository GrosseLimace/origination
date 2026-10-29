using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// Adds one of the producer's splits as a field. With CTRM's splits query (<c>Ctrm:SplitsSource</c> = ctrm) the
/// name, split % and effective date come from CTRM and these are ignored. SPLITS-GRAPHQL: until then they are
/// typed by the originator (the go-live "manual" source).
/// </summary>
public record CreateProducerFieldRequest
{
    [Range(1, long.MaxValue)]
    public required long CustomerId { get; init; }

    /// <summary>CTRM split (customer) codes are at most 7 letters/digits; checked in the service.</summary>
    [Required, StringLength(20, MinimumLength = 1)]
    public required string SplitId { get; init; }

    /// <summary>Manual splits only; defaults to the split ID.</summary>
    [StringLength(255)]
    public string? Name { get; init; }

    /// <summary>Manual splits only: the producer's share, defaults to 100.</summary>
    [Range(0.001, 100)]
    public decimal? SplitPercent { get; init; }

    /// <summary>Manual splits only, yyyy-MM-dd.</summary>
    public DateOnly? EffectiveDate { get; init; }

    [StringLength(2)]
    public string? State { get; init; }

    [StringLength(100)]
    public string? County { get; init; }
}

/// <summary>A field's location, and for a split typed by hand its name and share (CTRM's are read-only).</summary>
public record UpdateProducerFieldRequest
{
    [StringLength(2)]
    public string? State { get; init; }

    [StringLength(100)]
    public string? County { get; init; }

    /// <summary>Manual splits only; ignored for CTRM splits.</summary>
    [StringLength(255)]
    public string? Name { get; init; }

    /// <summary>Manual splits only; ignored for CTRM splits.</summary>
    [Range(0.001, 100)]
    public decimal? SplitPercent { get; init; }
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

/// <summary>Confirms a 45Z field after harvest with the tickets reviewed with the producer.</summary>
public record ConfirmFieldProgramRecordRequest
{
    /// <summary>bu/ac, prefilled on screen from the included tickets ÷ acres and editable.</summary>
    [Range(0.01, 1000)]
    public required double ActualYield { get; init; }

    /// <summary>The included tickets' keys, from GET records/{id}/tickets.</summary>
    [Required, MinLength(1), MaxLength(1000)]
    public required List<string> TicketKeys { get; init; }

    /// <summary>The originator's tick: reviewed with the producer after harvest.</summary>
    public required bool ReviewedWithProducer { get; init; }
}
