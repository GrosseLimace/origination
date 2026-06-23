namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Read-only projection of dbo.vw_UserTradeUnitAccess in the Entitlements database.
/// Represents a single trade unit assignment for a user (via direct assignment or group membership).
/// </summary>
public class UserTradeUnitAccess
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string TradeUnitCode { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? AssignmentSource { get; set; }
    public int? GroupId { get; set; }
    public string? GroupName { get; set; }
}
