namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>A selectable team member for the manager's "assign a list" picker — the short UPN used as
/// the assignment key plus the Azure AD display name for the dropdown.</summary>
public record TeamMemberResponse
{
    public string UserId { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
}
