namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// A member reference on a <see cref="DailyRecapGroup"/>. Stored as a reference (type + entitlements
/// id), NOT a frozen person list, so the Logic App can re-resolve the current recipients at send time:
///   - person          : MemberId = UPN, Email populated, send directly.
///   - trade-unit       : MemberId = TU code; expand to current users in that TU.
///   - trade-unit-group : MemberId = group name; expand to current users in that group.
/// </summary>
public class DailyRecapGroupMember
{
    public int Id { get; set; }
    public int RecapGroupId { get; set; }
    /// <summary>"person" | "trade-unit" | "trade-unit-group".</summary>
    public string MemberType { get; set; } = string.Empty;
    /// <summary>Entitlements identifier: UPN (person), TU code (trade-unit), group name (trade-unit-group).</summary>
    public string MemberId { get; set; } = string.Empty;
    public string MemberName { get; set; } = string.Empty;
    /// <summary>Populated only for person members — used directly as the recipient address.</summary>
    public string? Email { get; set; }

    public DailyRecapGroup? Group { get; set; }
}
