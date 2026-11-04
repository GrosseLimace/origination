using System.Text.Json;

namespace GrainOriginatorPortal.Api.Models.Responses;

// The shapes match client/src/app/models/field-plan.model.ts exactly, so the client's FieldPlanStore takes
// them as they come. Program data and frozen estimates are passed through as JSON.

/// <summary>Everything one producer has in the field plan, across all years.</summary>
public record FieldPlanSnapshotResponse
{
    public required IReadOnlyList<ProducerFieldResponse> Fields { get; init; }
    public required IReadOnlyList<FieldSeasonResponse> Seasons { get; init; }
    public required IReadOnlyList<FieldProgramRecordResponse> Records { get; init; }
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
    /// <summary>SPLITS-GRAPHQL: "Manual" (typed by hand until CTRM's splits query is live) or "Ctrm".</summary>
    public required string SplitSource { get; init; }
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
    /// <summary>The CI frozen when the field was confirmed; null unless Locked.</summary>
    public JsonElement? Frozen { get; init; }
    /// <summary>The confirmed CI with its bushels and tickets; null until the field is confirmed.</summary>
    public JsonElement? Official { get; init; }
    public JsonElement? Reopened { get; init; }
}

/// <summary>
/// A field's CTRM tickets for its crop year and crop: delivered under its split ID, settled or not. Each is
/// matched to the crop year by the contract it's applied to, or failing that by its BL date in the window.
/// </summary>
public record FieldTicketsResponse
{
    public required string SplitId { get; init; }
    public required int CropYear { get; init; }
    /// <summary>The crop the tickets were matched on, e.g. "corn".</summary>
    public string? CropGroup { get; init; }
    /// <summary>yyyy-MM-dd: the BL-date window for tickets not on a contract with a crop year.</summary>
    public required string WindowFrom { get; init; }
    public required string WindowTo { get; init; }
    public required IReadOnlyList<FieldTicketResponse> Tickets { get; init; }
    /// <summary>
    /// The split's other tickets for the crop, outside the crop year (another contract year, or a BL date
    /// outside the window). Not counted unless the originator adds one in the review.
    /// </summary>
    public IReadOnlyList<FieldTicketResponse> Others { get; init; } = [];
}

/// <summary>One delivery (a ticket's detail row for the split), as reviewed, confirmed and exported.</summary>
public record FieldTicketResponse
{
    /// <summary>Stable key for the detail row (ticket prefix, number, suffix, BL date, product, sequence).</summary>
    public required string TicketKey { get; init; }
    public required string TicketNumber { get; init; }
    /// <summary>
    /// The party the row is for: the producer or a partner on the split (e.g. a landlord). One ticket number has a
    /// row per party, all under the split ID.
    /// </summary>
    public string? CustomerCode { get; init; }
    /// <summary>yyyy-MM-dd.</summary>
    public string? BlDate { get; init; }
    /// <summary>Elevator, e.g. "Pratt, KS (PRA)".</summary>
    public string? Location { get; init; }
    public string? ProductCode { get; init; }
    public string? ContractNumber { get; init; }
    /// <summary>
    /// "contract" (the applied contract's crop year), "window" (BL date in the crop year's window), "other"
    /// (outside the crop year, offered to add) or, once confirmed, "added" (an "other" the originator added).
    /// </summary>
    public required string CropYearMatch { get; init; }
    /// <summary>Why an "other" ticket is outside the crop year, e.g. "On a 2025 contract".</summary>
    public string? Note { get; init; }
    /// <summary>The crop year whose confirmed CI already counts this ticket; it can't be counted twice.</summary>
    public int? ConfirmedFor { get; init; }
    /// <summary>Net bushels for this party's row; null when the pounds or the conversion are missing.</summary>
    public decimal? NetBushels { get; init; }
    public required bool Settled { get; init; }
    /// <summary>yyyy-MM-dd.</summary>
    public string? SettledDate { get; init; }
    public string? Status { get; init; }
}
