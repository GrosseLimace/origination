namespace GrainOriginatorPortal.Api.Models;

public class TradeUnitGroup
{
    public int Id { get; set; }
    public string GroupName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public List<GroupTradeUnit> TradeUnits { get; set; } = new();
}

public class GroupTradeUnit
{
    public int Id { get; set; }
    public int GroupId { get; set; }
    public string TradeUnitCode { get; set; } = string.Empty;
    public string? Location { get; set; }
    public bool IsActive { get; set; }
}
