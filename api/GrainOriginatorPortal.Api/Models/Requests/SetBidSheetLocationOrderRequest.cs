using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record SetBidSheetLocationOrderRequest
{
    [Required, MaxLength(500)]
    public string TradeUnitKey { get; init; } = string.Empty;

    [Required]
    public string LocationOrder { get; init; } = "[]";
}
