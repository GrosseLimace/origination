using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Inbound payload for POST /api/usage-dashboard/excluded-users — hides one account from
/// every usage-dashboard view. Accepts either a short name or a full UPN; the service normalizes.</summary>
public record AddExcludedUserRequest
{
    [Required]
    [MaxLength(256)]
    public string UserId { get; init; } = string.Empty;

    [MaxLength(500)]
    public string? Reason { get; init; }
}
