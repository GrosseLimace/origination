using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class SetBidReferenceRequest
{
    [Required, MaxLength(100)]
    public string TradeUnitCode { get; set; } = string.Empty;

    [Required, MaxLength(50)]
    public string CommodityCode { get; set; } = string.Empty;

    [Required, MaxLength(50)]
    public string ElevatorCode { get; set; } = string.Empty;
}
