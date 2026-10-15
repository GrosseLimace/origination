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

    /// <summary>True when the caller created this group. Narrower than <see cref="CanEdit"/> — it
    /// gates DELETE, which stays creator-only, plus the "Created by" label on a group you joined
    /// rather than made.</summary>
    public bool IsOwner { get; init; } = true;

    /// <summary>True when the caller may edit this group: rename it, add or remove members, change
    /// the CC list, and toggle the daily recap. Edit rights equal visibility, so this is true for
    /// every group the list returns — kept as an explicit server-computed flag anyway so the policy
    /// lives here rather than in the client, and so it can be tightened without a client deploy.</summary>
    public bool CanEdit { get; init; } = true;

    /// <summary>The creator's UPN/email. Shown on groups the caller did not create, so they know who
    /// set it up and who can delete it.</summary>
    public string CreatedBy { get; init; } = string.Empty;
}

public record RecapGroupMemberDto
{
    public string Type { get; init; } = string.Empty;
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Email { get; init; }
}
