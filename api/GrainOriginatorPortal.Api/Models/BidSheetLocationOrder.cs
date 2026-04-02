namespace GrainOriginatorPortal.Api.Models;

public class BidSheetLocationOrder
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string TradeUnitKey { get; set; } = string.Empty;
    public string LocationOrder { get; set; } = "[]";
    public DateTime ModifiedAt { get; set; }
}
