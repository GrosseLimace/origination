using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreateReminderRequest
{
    [Required]
    public required long CustomerId { get; init; }

    /// <summary>When the follow-up is due, in UTC. The client converts from the local time the
    /// user picked, so the same instant reaches Outlook and the badge.</summary>
    [Required]
    public required DateTime DueAt { get; init; }

    /// <summary>Optional; the service falls back to "Follow up with {producer}".</summary>
    [StringLength(200)]
    public string? Subject { get; init; }

    [StringLength(2000)]
    public string? Notes { get; init; }
}
