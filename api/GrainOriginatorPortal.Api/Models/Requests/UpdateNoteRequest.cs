using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class UpdateNoteRequest
{
    [Required]
    [StringLength(2000)]
    public string Content { get; set; } = string.Empty;
}
