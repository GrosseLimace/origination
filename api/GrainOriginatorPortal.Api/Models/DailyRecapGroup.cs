namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// A user-configured Daily Recap group: a named set of recipients (people / trade units /
/// trade-unit groups) plus optional CC addresses, delivered by Email or posted to a Microsoft
/// Teams channel. The external Logic App reads these groups and re-resolves trade-unit / group
/// members against entitlements (vw_UserTradeUnitAccess) at send time, so membership changes and
/// departures are reflected without the group being re-saved.
/// </summary>
public class DailyRecapGroup
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>"email" or "teams".</summary>
    public string DeliveryMethod { get; set; } = "email";
    /// <summary>Microsoft Teams channel email — populated only when DeliveryMethod is "teams".</summary>
    public string? TeamsChannelEmail { get; set; }
    /// <summary>UI on/off toggle. The Logic App only sends for enabled groups.</summary>
    public bool Enabled { get; set; } = true;
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    public List<DailyRecapGroupMember> Members { get; set; } = [];
    public List<DailyRecapGroupCcEmail> CcEmails { get; set; } = [];
}
