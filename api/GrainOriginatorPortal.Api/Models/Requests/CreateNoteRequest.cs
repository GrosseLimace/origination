using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class CreateNoteRequest
{
    [Required]
    public long CustomerId { get; set; }

    [Required]
    [StringLength(2000)]
    public string Content { get; set; } = string.Empty;

    public string? TradeUnit { get; set; }
}
