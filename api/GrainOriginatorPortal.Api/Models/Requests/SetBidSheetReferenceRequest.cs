using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class SetBidSheetReferenceRequest
{
    [Required, MaxLength(100)]
    public string TradeUnitCode { get; set; } = string.Empty;

    [Required]
    public int LocationId { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;
}
