using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpdateNoteRequest
{
    [Required]
    [StringLength(2000)]
    public required string Content { get; init; }
}
