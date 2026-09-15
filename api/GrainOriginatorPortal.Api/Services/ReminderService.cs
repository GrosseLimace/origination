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

    public ReminderService(
        IReminderRepository repository,
        ICustomerRepository customers,
        IRequestContextService requestContext)
    {
        _repository = repository;
        _customers = customers;
        _requestContext = requestContext;
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
        return updated == null ? null : Map(updated);
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

    public Task<bool> DeleteAsync(int reminderId, CancellationToken cancellationToken)
    {
        var owner = _requestContext.GetCurrentUser();
        return _repository.DeleteAsync(reminderId, owner, cancellationToken);
    }

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
