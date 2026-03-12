using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreateNoteRequest
{
    [Required]
    public required long CustomerId { get; init; }

    [Required]
    [StringLength(5000)]
    public required string Content { get; init; }

    [StringLength(100)]
    public string? TradeUnit { get; init; }
}
