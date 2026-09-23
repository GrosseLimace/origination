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

    /// <summary>
    /// Optional "@" mentions (person / trade unit / group) chosen while composing the note.
    /// Persisted as a JSON array in Notes.Mentions. No picker UI sends these yet.
    /// </summary>
    [MaxLength(50)]
    public IReadOnlyList<NoteMention>? Mentions { get; init; }
}
