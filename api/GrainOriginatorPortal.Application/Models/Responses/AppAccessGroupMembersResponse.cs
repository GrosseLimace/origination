namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>One user from the app-access Entra group.</summary>
public record AppAccessGroupMemberResponse
{
    public string? DisplayName { get; init; }
    public string? UserPrincipalName { get; init; }
    public bool? AccountEnabled { get; init; }
}

/// <summary>
/// Result of the app-access spike: the transitive member list of the configured Entra group,
/// or a categorized reason it couldn't be read (Outcome: Ok | TokenFailure | EgressBlocked |
/// PermissionMissing | NotFound | NotConfigured | Error — Detail carries the remediation hint).
/// Always returned with HTTP 200; the Outcome field is the verdict.
/// </summary>
public record AppAccessGroupMembersResponse
{
    public string GroupName { get; init; } = string.Empty;
    public string Outcome { get; init; } = string.Empty;
    public int? HttpStatus { get; init; }
    public string? Detail { get; init; }
    public int MemberCount { get; init; }
    public List<AppAccessGroupMemberResponse> Members { get; init; } = [];
}
