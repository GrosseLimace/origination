using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreatePlantingIntentionRequest
{
    [Required]
    public required long CustomerId { get; init; }

    // Customer metadata is optional on the wire — the controller derives the
    // authoritative value from dbo.Customer + dbo.CustomerTradeUnit when the
    // customer exists there, so the client can send blank/unknown values for these
    // (e.g. when the user has no trade unit selected in the header filter) and the
    // server will fill them in. Trade units are a UX filter only, not an access boundary.
    [StringLength(255)]
    public string? CustomerName { get; init; }

    [StringLength(50)]
    public string? CustomerCode { get; init; }

    [StringLength(100)]
    public string? TradeUnit { get; init; }

    [Required]
    [StringLength(100)]
    public required string Crop { get; init; }

    [StringLength(100)]
    public string? Category { get; init; }

    [StringLength(100)]
    public string? Type { get; init; }

    [StringLength(255)]
    public string? Description { get; init; }

    // For a Double Crop intention the client generates one GUID and sends it on BOTH
    // create requests, linking the two rows so the UI can show them as a single line.
    // Null/omitted for a normal single-crop intention.
    [StringLength(50)]
    public string? DoubleCropGroupId { get; init; }

    [Range(1, 100000)]
    public int Acres { get; init; }

    [Range(2020, 2100)]
    public int PlantingYear { get; init; }
}
