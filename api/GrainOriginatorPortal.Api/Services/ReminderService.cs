using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

public class ReminderService : IReminderService
{
    /// <summary>
    /// How far in the past a new or edited due date may sit. A small window rather than zero: a
    /// user picking "today 9:00" in the afternoon is setting a reminder for today, not making a
    /// mistake, and the browser clock can differ from the server by minutes.
    /// </summary>
    private static readonly TimeSpan MaxBackdate = TimeSpan.FromDays(1);

    private const int MaxSubjectLength = 200;
    private const int MaxNotesLength = 2000;

    private readonly IReminderRepository _repository;
    private readonly ICustomerRepository _customers;
    private readonly IRequestContextService _requestContext;
    private readonly IOutlookCalendarService _calendar;

    public ReminderService(
        IReminderRepository repository,
        ICustomerRepository customers,
        IRequestContextService requestContext,
        IOutlookCalendarService calendar)
    {
        _repository = repository;
        _customers = customers;
        _requestContext = requestContext;
        _calendar = calendar;
    }

    // -------------------------------------------------------------------------
    public async Task<List<ReminderResponse>> GetByCustomerAsync(long customerId, bool includeCompleted, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();
        var reminders = await _repository.GetByCustomerAsync(customerId, owner, includeCompleted, cancellationToken);
        return reminders.Select(Map).ToList();
    }

    public async Task<List<ReminderDueResponse>> GetMineAsync(CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();
        var reminders = await _repository.GetOpenForOwnerAsync(owner, cancellationToken);
        return reminders
            .Select(r => new ReminderDueResponse
            {
                Id = r.Id,
                CustomerId = r.CustomerId,
                CustomerCode = r.CustomerCode,
                DueAt = r.DueAt
            })
            .ToList();
    }

    public async Task<ReminderResponse> CreateAsync(CreateReminderRequest request, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();

        // The producer has to exist before we hang a reminder off it — the FK would reject the
        // insert anyway, and a 404 explains the problem far better than a 500 from the database.
        var customer = await _customers.GetByIdAsync(request.CustomerId, cancellationToken)
            ?? throw new NotFoundException("Customer", request.CustomerId);

        var dueAt = NormalizeDueAt(request.DueAt);
        var subject = ResolveSubject(request.Subject, customer.Name);
        var notes = NormalizeNotes(request.Notes);

        var created = await _repository.AddAsync(request.CustomerId, dueAt, subject, notes, owner, cancellationToken);
        return Map(created);
    }

    public async Task<ReminderResponse?> UpdateAsync(int reminderId, UpdateReminderRequest request, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();

        // Load first so the subject fallback can use the producer name, and so an edit of somebody
        // else reminder stops here rather than after validation.
        var existing = await _repository.GetByIdAsync(reminderId, owner, cancellationToken);
        if (existing == null)
        {
            return null;
        }

        var dueAt = NormalizeDueAt(request.DueAt);
        var subject = ResolveSubject(request.Subject, existing.CustomerName);
        var notes = NormalizeNotes(request.Notes);

        var updated = await _repository.UpdateAsync(reminderId, owner, dueAt, subject, notes, cancellationToken);
        if (updated == null) return null;

        // Keep the calendar in step with the row. The DATABASE is the source of truth and the event
        // is a best-effort mirror, so a calendar failure must never fail or roll back the save — the
        // service swallows its own errors, and the response simply reports what happened.
        var calendarMoved = true;
        if (!string.IsNullOrWhiteSpace(updated.OutlookEventId) && dueAt != existing.DueAt)
        {
            calendarMoved = await _calendar.UpdateEventWindowAsync(
                updated.OutlookEventId!, dueAt, ResolveTimeZone(request.TimeZone), cancellationToken);
        }

        return Map(updated) with { OutlookEventMoved = calendarMoved };
    }

    public async Task<ReminderResponse?> SetCompletedAsync(int reminderId, bool isCompleted, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();
        var updated = await _repository.SetCompletedAsync(reminderId, owner, isCompleted, cancellationToken);
        return updated == null ? null : Map(updated);
    }

    public async Task<ReminderResponse?> SetOutlookEventIdAsync(int reminderId, string? outlookEventId, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();
        var trimmed = string.IsNullOrWhiteSpace(outlookEventId) ? null : outlookEventId.Trim();
        var updated = await _repository.SetOutlookEventIdAsync(reminderId, owner, trimmed, cancellationToken);
        return updated == null ? null : Map(updated);
    }

    public async Task<bool> DeleteAsync(int reminderId, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();

        // Read the event id BEFORE the row goes, or there is nothing left to clean up afterwards.
        // This is the only path that removes the event: the user asked for the follow-up to go away.
        // Completing one deliberately leaves it, because deleting makes Outlook render it as
        // "Canceled", which reads as "this never happened" rather than "done".
        var existing = await _repository.GetByIdAsync(reminderId, owner, cancellationToken);

        var deleted = await _repository.DeleteAsync(reminderId, owner, cancellationToken);
        if (!deleted) return false;

        if (!string.IsNullOrWhiteSpace(existing?.OutlookEventId))
        {
            // Best effort, as everywhere else: a stranded calendar event is a far smaller problem
            // than a delete that appears to fail after the row has already gone.
            await _calendar.DeleteEventAsync(existing!.OutlookEventId!, cancellationToken);
        }

        return true;
    }

    /// <inheritdoc />
    public async Task<ReminderResponse?> AddToOutlookAsync(
        int reminderId, AddReminderToOutlookRequest request, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();
        var reminder = await _repository.GetByIdAsync(reminderId, owner, cancellationToken);
        if (reminder == null) return null;

        // Already on the calendar — return as-is rather than creating a duplicate event. The client
        // retry button can be pressed twice, and two blocks in a calendar is worse than a no-op.
        if (!string.IsNullOrWhiteSpace(reminder.OutlookEventId)) return Map(reminder);

        var eventId = await _calendar.CreateEventAsync(new OutlookEventRequest
        {
            Subject = reminder.Subject,
            CustomerName = reminder.CustomerName,
            Notes = reminder.Notes,
            DueAtUtc = reminder.DueAt,
            TimeZone = ResolveTimeZone(request.TimeZone),
            ProducerLink = request.ProducerLink,
        }, cancellationToken);

        if (eventId == null)
        {
            // Null event id is the signal the row uses to keep offering "Add to Outlook".
            return Map(reminder);
        }

        var updated = await _repository.SetOutlookEventIdAsync(reminderId, owner, eventId, cancellationToken);
        return updated == null ? Map(reminder) : Map(updated);
    }

    /// <summary>The browser's IANA zone, defaulting to UTC when it is missing. The server cannot
    /// infer where the user is sitting, and guessing its own zone would put the event at the wrong
    /// hour for anyone elsewhere.</summary>
    private static string ResolveTimeZone(string? timeZone) =>
        string.IsNullOrWhiteSpace(timeZone) ? "UTC" : timeZone.Trim();

    // -------------------------------------------------------------------------
    /// <summary>
    /// Forces the due date to UTC and rejects anything meaningfully in the past. A client that
    /// sends an unspecified-kind timestamp is taken at its word as UTC (the JSON converters send
    /// UTC), rather than being silently shifted by the server local zone.
    /// </summary>
    private DateTime NormalizeDueAt(DateTime dueAt)
    {
        var utc = dueAt.Kind switch
        {
            DateTimeKind.Utc => dueAt,
            DateTimeKind.Local => dueAt.ToUniversalTime(),
            _ => DateTime.SpecifyKind(dueAt, DateTimeKind.Utc)
        };

        if (utc < DateTime.UtcNow - MaxBackdate)
        {
            throw new ValidationException("dueAt", "A follow-up cannot be scheduled in the past.");
        }

        return utc;
    }

    private static string ResolveSubject(string? subject, string? customerName)
    {
        var trimmed = subject?.Trim();
        if (!string.IsNullOrEmpty(trimmed))
        {
            return trimmed.Length > MaxSubjectLength ? trimmed[..MaxSubjectLength] : trimmed;
        }

        var producer = string.IsNullOrWhiteSpace(customerName) ? "this producer" : customerName.Trim();
        var fallback = $"Follow up with {producer}";
        return fallback.Length > MaxSubjectLength ? fallback[..MaxSubjectLength] : fallback;
    }

    private static string? NormalizeNotes(string? notes)
    {
        var trimmed = notes?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length > MaxNotesLength ? trimmed[..MaxNotesLength] : trimmed;
    }

    private static ReminderResponse Map(ProducerReminder reminder) => new()
    {
        Id = reminder.Id,
        CustomerId = reminder.CustomerId,
        CustomerName = reminder.CustomerName,
        CustomerCode = reminder.CustomerCode,
        DueAt = reminder.DueAt,
        Subject = reminder.Subject,
        Notes = reminder.Notes,
        OutlookEventId = reminder.OutlookEventId,
        IsCompleted = reminder.IsCompleted,
        CompletedAt = reminder.CompletedAt,
        CreatedAt = reminder.CreatedAt,
        ModifiedAt = reminder.ModifiedAt
    };
}
