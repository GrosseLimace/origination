using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class CreateSavedListRequest
{
    [Required]
    [StringLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [StringLength(500)]
    public string Query { get; set; } = string.Empty;

    [StringLength(500)]
    public string? TradeUnits { get; set; }

    public string? Filters { get; set; }
}
