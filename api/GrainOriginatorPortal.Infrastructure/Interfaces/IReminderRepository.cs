using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for personal producer follow-up reminders (dbo.ProducerReminders, hard-deleted).
///
/// EVERY method takes the owner's UPN and filters on it. There is deliberately no "get by id"
/// without an owner and no admin override: a reminder is private to the user who created it, so
/// owner scoping is a property of the data-access layer rather than a check a caller can forget.
/// A row that exists but belongs to someone else is indistinguishable from a row that does not
/// exist — every lookup returns null, which the service turns into a 404.
///
/// CustomerName/CustomerCode are composed from the Customer FK join (those columns are not on the
/// table), exactly as NoteRepository does.
/// </summary>
public interface IReminderRepository
{
    /// <summary>The owner's reminders for one producer, soonest due first.</summary>
    Task<List<ProducerReminder>> GetByCustomerAsync(long customerId, string owner, bool includeCompleted, CancellationToken cancellationToken);

    /// <summary>Every OPEN reminder the owner has, across all producers — the badge feed.</summary>
    Task<List<ProducerReminder>> GetOpenForOwnerAsync(string owner, CancellationToken cancellationToken);

    Task<ProducerReminder?> GetByIdAsync(int reminderId, string owner, CancellationToken cancellationToken);

    Task<ProducerReminder> AddAsync(long customerId, DateTime dueAtUtc, string subject, string? notes, string owner, CancellationToken cancellationToken);

    Task<ProducerReminder?> UpdateAsync(int reminderId, string owner, DateTime dueAtUtc, string subject, string? notes, CancellationToken cancellationToken);

    Task<ProducerReminder?> SetCompletedAsync(int reminderId, string owner, bool isCompleted, CancellationToken cancellationToken);

    /// <summary>Stores the Graph event id after the browser wrote the event (null clears it).</summary>
    Task<ProducerReminder?> SetOutlookEventIdAsync(int reminderId, string owner, string? outlookEventId, CancellationToken cancellationToken);

    /// <summary>True when a row was actually removed; false when the owner has no such reminder.</summary>
    Task<bool> DeleteAsync(int reminderId, string owner, CancellationToken cancellationToken);
}
