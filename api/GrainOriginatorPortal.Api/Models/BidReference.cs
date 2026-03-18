namespace GrainOriginatorPortal.Api.Models;

public class BidReference
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string TradeUnitCode { get; set; } = string.Empty;
    public string CommodityCode { get; set; } = string.Empty;
    public string ElevatorCode { get; set; } = string.Empty;
    public DateTime ModifiedAt { get; set; }
}
