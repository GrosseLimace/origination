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
}

public record RecapGroupMemberDto
{
    public string Type { get; init; } = string.Empty;
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Email { get; init; }
}
