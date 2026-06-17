using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpdateNoteRequest
{
    [Required]
    [StringLength(5000)]
    public required string Content { get; init; }

    /// <summary>
    /// Optional "@" mentions (person / trade unit / group). Persisted as a JSON array in
    /// Notes.Mentions, replacing any existing mentions on update. No picker UI sends these yet.
    /// </summary>
    [MaxLength(50)]
    public IReadOnlyList<NoteMention>? Mentions { get; init; }
}
