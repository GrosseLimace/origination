using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Modules.Engagement.Models.Requests;

public record SetReminderCompletedRequest
{
    [Required]
    public required bool IsCompleted { get; init; }
}
