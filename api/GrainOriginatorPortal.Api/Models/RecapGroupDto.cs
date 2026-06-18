namespace GrainOriginatorPortal.Api.Models;

/// <summary>Response shape for a Daily Recap group, mirroring the frontend RecapGroup model
/// (members as references, ccList as flat email strings).</summary>
public record RecapGroupDto
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string DeliveryMethod { get; init; } = "email";
    public string? TeamsChannelEmail { get; init; }
    public bool Enabled { get; init; }
    public List<RecapGroupMemberDto> Members { get; init; } = [];
    public List<string> CcList { get; init; } = [];

    /// <summary>True when the caller created this group (full edit rights). False for groups the
    /// caller only sees because they're a member — the UI shows those faded and read-only.</summary>
    public bool IsOwner { get; init; } = true;

    /// <summary>The creator's UPN/email. Shown on read-only (member) cards so a member can reach
    /// out to whoever owns the group.</summary>
    public string CreatedBy { get; init; } = string.Empty;
}

public record RecapGroupMemberDto
{
    public string Type { get; init; } = string.Empty;
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Email { get; init; }
}
