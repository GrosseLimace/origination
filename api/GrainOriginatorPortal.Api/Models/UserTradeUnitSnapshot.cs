namespace GrainOriginatorPortal.Api.Models;

public class UserTradeUnitSnapshot
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string TradeUnitCode { get; set; } = string.Empty;
    public string? GroupName { get; set; }
    public DateOnly SnapshotDate { get; set; }
}
