using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpdateReminderRequest
{
    /// <summary>When the follow-up is due, in UTC.</summary>
    [Required]
    public required DateTime DueAt { get; init; }

    [StringLength(200)]
    public string? Subject { get; init; }

    [StringLength(2000)]
    public string? Notes { get; init; }
}
