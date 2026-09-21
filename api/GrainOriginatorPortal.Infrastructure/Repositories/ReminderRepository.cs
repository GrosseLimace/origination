using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class ReminderRepository : IReminderRepository
{
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<ReminderRepository> _logger;

    public ReminderRepository(ApplicationDbContext appContext, ILogger<ReminderRepository> logger)
    {
        _appContext = appContext;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// The single owner predicate used by every read and write in this repository. Lower-cases both
    /// sides rather than relying on the database collation: the default SQL Server collation is
    /// case-insensitive, but the SQLite provider the repository tests run on is not, and an owner
    /// check that behaves differently under test than in production is worth nothing.
    /// </summary>
    private static string Normalize(string owner) => (owner ?? string.Empty).Trim().ToLower();

    public async Task<List<ProducerReminder>> GetByCustomerAsync(long customerId, string owner, bool includeCompleted, CancellationToken cancellationToken)
    {
        var ownerKey = Normalize(owner);

        var query = _appContext.ProducerReminders.AsNoTracking()
            .Where(r => r.CustomerId == customerId && r.CreatedBy.ToLower() == ownerKey);

        if (!includeCompleted)
        {
            query = query.Where(r => !r.IsCompleted);
        }

        var rows = await query
            .OrderBy(r => r.IsCompleted)
            .ThenBy(r => r.DueAt)
            .Select(r => new
            {
                Reminder = r,
                CustomerName = r.Customer!.Name,
                CustomerCode = r.Customer!.ScoularId
            })
            .ToListAsync(cancellationToken);

        return rows.Select(row => Compose(row.Reminder, row.CustomerName, row.CustomerCode)).ToList();
    }

    public async Task<List<ProducerReminder>> GetOpenForOwnerAsync(string owner, CancellationToken cancellationToken)
    {
        var ownerKey = Normalize(owner);

        // Bounded by how many follow-ups one person has scheduled, so this stays small no matter
        // how many reminders the team accumulates. Ships no completed rows.
        var rows = await _appContext.ProducerReminders.AsNoTracking()
            .Where(r => r.CreatedBy.ToLower() == ownerKey && !r.IsCompleted)
            .OrderBy(r => r.DueAt)
            .Select(r => new
            {
                Reminder = r,
                CustomerName = r.Customer!.Name,
                CustomerCode = r.Customer!.ScoularId
            })
            .ToListAsync(cancellationToken);

        return rows.Select(row => Compose(row.Reminder, row.CustomerName, row.CustomerCode)).ToList();
    }

    public async Task<ProducerReminder?> GetByIdAsync(int reminderId, string owner, CancellationToken cancellationToken)
    {
        var ownerKey = Normalize(owner);

        var reminder = await _appContext.ProducerReminders.AsNoTracking()
            .Include(r => r.Customer)
            .FirstOrDefaultAsync(r => r.Id == reminderId && r.CreatedBy.ToLower() == ownerKey, cancellationToken);

        return reminder == null ? null : Hydrate(reminder);
    }

    public async Task<ProducerReminder> AddAsync(long customerId, DateTime dueAtUtc, string subject, string? notes, string owner, CancellationToken cancellationToken)
    {
        var reminder = new ProducerReminder
        {
            CustomerId = customerId,
            DueAt = dueAtUtc,
            Subject = subject,
            Notes = notes,
            CreatedBy = owner,
            CreatedAt = DateTime.UtcNow
        };

        _appContext.ProducerReminders.Add(reminder);
        await _appContext.SaveChangesAsync(cancellationToken);

        // The insert wrote CustomerId only; read back the producer identity for the response.
        var snap = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => new { c.Name, c.ScoularId })
            .FirstOrDefaultAsync(cancellationToken);

        _logger.LogInformation("Created reminder {ReminderId} for customer {CustomerId}", reminder.Id, customerId);
        return Compose(reminder, snap?.Name, snap?.ScoularId);
    }

    public async Task<ProducerReminder?> UpdateAsync(int reminderId, string owner, DateTime dueAtUtc, string subject, string? notes, CancellationToken cancellationToken)
    {
        var reminder = await LoadTrackedAsync(reminderId, owner, cancellationToken);
        if (reminder == null)
        {
            return null;
        }

        reminder.DueAt = dueAtUtc;
        reminder.Subject = subject;
        reminder.Notes = notes;
        reminder.ModifiedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Updated reminder {ReminderId}", reminderId);
        return Hydrate(reminder);
    }

    public async Task<ProducerReminder?> SetCompletedAsync(int reminderId, string owner, bool isCompleted, CancellationToken cancellationToken)
    {
        var reminder = await LoadTrackedAsync(reminderId, owner, cancellationToken);
        if (reminder == null)
        {
            return null;
        }

        reminder.IsCompleted = isCompleted;
        reminder.CompletedAt = isCompleted ? DateTime.UtcNow : null;
        reminder.ModifiedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Reminder {ReminderId} completion set to {IsCompleted}", reminderId, isCompleted);
        return Hydrate(reminder);
    }

    public async Task<ProducerReminder?> SetOutlookEventIdAsync(int reminderId, string owner, string? outlookEventId, CancellationToken cancellationToken)
    {
        var reminder = await LoadTrackedAsync(reminderId, owner, cancellationToken);
        if (reminder == null)
        {
            return null;
        }

        // Deliberately does NOT touch ModifiedAt: linking the calendar event is bookkeeping about
        // the reminder, not an edit the user made to it.
        reminder.OutlookEventId = outlookEventId;
        await _appContext.SaveChangesAsync(cancellationToken);

        return Hydrate(reminder);
    }

    public async Task<bool> DeleteAsync(int reminderId, string owner, CancellationToken cancellationToken)
    {
        var reminder = await LoadTrackedAsync(reminderId, owner, cancellationToken);
        if (reminder == null)
        {
            return false;
        }

        // Hard delete. Unlike a note, a reminder is a transient personal to-do with no audit value
        // once its owner removes it, so there is nothing to recover later.
        _appContext.ProducerReminders.Remove(reminder);
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Deleted reminder {ReminderId}", reminderId);
        return true;
    }

    // -------------------------------------------------------------------------
    private Task<ProducerReminder?> LoadTrackedAsync(int reminderId, string owner, CancellationToken cancellationToken)
    {
        var ownerKey = Normalize(owner);
        return _appContext.ProducerReminders
            .Include(r => r.Customer)
            .FirstOrDefaultAsync(r => r.Id == reminderId && r.CreatedBy.ToLower() == ownerKey, cancellationToken);
    }

    private static ProducerReminder Hydrate(ProducerReminder reminder)
    {
        reminder.CustomerName = reminder.Customer?.Name ?? string.Empty;
        reminder.CustomerCode = reminder.Customer?.ScoularId;
        return reminder;
    }

    private static ProducerReminder Compose(ProducerReminder reminder, string? customerName, string? customerCode)
    {
        reminder.CustomerName = customerName ?? string.Empty;
        reminder.CustomerCode = customerCode;
        return reminder;
    }
}
