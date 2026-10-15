namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Personal producer follow-up reminders. Every method acts as the CURRENT USER: the service reads
/// the caller identity from <see cref="IRequestContextService"/> and never takes an owner argument,
/// so a controller cannot accidentally ask for someone else reminders.
///
/// Mutations return null when the caller has no such reminder — whether it does not exist or
/// belongs to another user, which the API deliberately does not distinguish.
/// </summary>
public interface IReminderService
{
    Task<List<ReminderResponse>> GetByCustomerAsync(long customerId, bool includeCompleted, CancellationToken cancellationToken);

    /// <summary>Every open reminder the caller owns — the producer-list badge feed.</summary>
    Task<List<ReminderDueResponse>> GetMineAsync(CancellationToken cancellationToken);

    Task<ReminderResponse> CreateAsync(CreateReminderRequest request, CancellationToken cancellationToken);

    Task<ReminderResponse?> UpdateAsync(int reminderId, UpdateReminderRequest request, CancellationToken cancellationToken);

    Task<ReminderResponse?> SetCompletedAsync(int reminderId, bool isCompleted, CancellationToken cancellationToken);

    Task<ReminderResponse?> SetOutlookEventIdAsync(int reminderId, string? outlookEventId, CancellationToken cancellationToken);

    /// <summary>True when a reminder was removed; false when the caller owns no such reminder.</summary>
    Task<bool> DeleteAsync(int reminderId, CancellationToken cancellationToken);

    /// <summary>Writes an existing reminder to the caller's own Outlook calendar and records the
    /// event id. Idempotent: a reminder already on the calendar comes back unchanged rather than
    /// gaining a second event. Returns the reminder with a null OutlookEventId when the calendar
    /// could not be written, which is what keeps the row's "Add to Outlook" retry showing.</summary>
    Task<ReminderResponse?> AddToOutlookAsync(int reminderId, AddReminderToOutlookRequest request, CancellationToken cancellationToken);
}
