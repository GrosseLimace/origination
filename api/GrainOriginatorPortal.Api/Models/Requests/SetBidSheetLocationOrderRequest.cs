using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class SetBidSheetLocationOrderRequest
{
    [Required, MaxLength(500)]
    public string TradeUnitKey { get; set; } = string.Empty;

    [Required]
    public string LocationOrder { get; set; } = "[]";
}
