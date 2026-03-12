using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpdateNoteRequest
{
    [Required]
    [StringLength(5000)]
    public required string Content { get; init; }
}
