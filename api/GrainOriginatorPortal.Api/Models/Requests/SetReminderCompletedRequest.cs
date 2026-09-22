using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record SetReminderCompletedRequest
{
    [Required]
    public required bool IsCompleted { get; init; }
}
