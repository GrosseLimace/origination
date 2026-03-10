using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreateNoteRequest
{
    [Required]
    public required long CustomerId { get; init; }

    [Required]
    [StringLength(2000)]
    public required string Content { get; init; }

    public string? TradeUnit { get; init; }
}
