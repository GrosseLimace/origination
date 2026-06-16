using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class NoteRepository : INoteRepository
{
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<NoteRepository> _logger;

    public NoteRepository(ApplicationDbContext appContext, ILogger<NoteRepository> logger)
    {
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<List<Note>> GetAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Attempting to retrieve notes from database");

        var query = _appContext.Notes.AsNoTracking()
            .Include(n => n.Customer)
            .Where(n => !n.IsDeleted);
        var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
        if (tuList is { Count: > 0 })
        {
            // Filter by the CUSTOMER's current trade unit, not the note's own
            // TradeUnit tag. The tag is set at note-creation time via
            // FirstOrDefaultAsync on CustomerTradeUnit — non-deterministic when
            // a customer is in multiple TUs — so notes on the same producer can
            // end up scattered across TU tags. The result was that a single-TU
            // selection could miss notes for a multi-TU producer that the user
            // was actively viewing. Anchoring the filter on the customer's
            // current TU set returns every note for any customer in scope,
            // regardless of which TU happened to win the FirstOrDefaultAsync
            // race at write time. (The TradeUnit column is now informational
            // only; writes still set it for audit purposes.)
            query = query.Where(n =>
                _appContext.CustomerTradeUnits.Any(ctu =>
                    ctu.CustomerId == n.CustomerId
                    && ctu.IsActive
                    && tuList.Contains(ctu.TradeUnit)));
        }
        var notes = await query
            .OrderByDescending(n => n.CreatedAt)
            .ToListAsync(cancellationToken);
        foreach (var n in notes)
        {
            // CustomerName / CustomerCode now come from the Customer FK join
            // (the columns were dropped from dbo.Notes in Phase 3b).
            n.CustomerName = n.Customer?.Name ?? string.Empty;
            n.CustomerCode = n.Customer?.ScoularId;
        }
        return notes;
    }

    public async Task<List<Note>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var notes = await _appContext.Notes
            .AsNoTracking()
            .Include(n => n.Customer)
            .Where(n => n.CustomerId == customerId && !n.IsDeleted)
            .OrderByDescending(n => n.CreatedAt)
            .ToListAsync(cancellationToken);
        foreach (var n in notes)
        {
            n.CustomerName = n.Customer?.Name ?? string.Empty;
            n.CustomerCode = n.Customer?.ScoularId;
        }
        return notes;
    }

    public async Task<Note?> GetByIdAsync(long noteId, CancellationToken cancellationToken)
    {
        var note = await _appContext.Notes.AsNoTracking()
            .Include(n => n.Customer)
            .FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
        if (note != null)
        {
            note.CustomerName = note.Customer?.Name ?? string.Empty;
            note.CustomerCode = note.Customer?.ScoularId;
        }
        return note;
    }

    public async Task<Note> AddAsync(long customerId, string content, string? tradeUnit, string currentUser, CancellationToken cancellationToken)
    {
        // Resolve denormalized name/code from dbo.Customer (the UI's source of truth).
        var snap = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => new { CustomerName = c.Name, c.ScoularId })
            .FirstOrDefaultAsync(cancellationToken);

        var note = new Note
        {
            CustomerId = customerId,
            CustomerName = snap?.CustomerName ?? string.Empty,
            CustomerCode = snap?.ScoularId,
            TradeUnit = tradeUnit,
            Description = content,
            CreatedBy = currentUser,
            CreatedAt = DateTime.UtcNow
        };

        _appContext.Notes.Add(note);
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Created note {NoteId} for customer {CustomerId}", note.Id, customerId);
        return note;
    }

    public async Task<Note?> TogglePinAsync(long noteId, CancellationToken cancellationToken)
    {
        var note = await _appContext.Notes
            .Include(n => n.Customer)
            .FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
        if (note == null)
        {
            return null;
        }

        note.IsPinned = !note.IsPinned;
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Toggled pin for note {NoteId} - IsPinned is now {IsPinned}", noteId, note.IsPinned);
        note.CustomerName = note.Customer?.Name ?? string.Empty;
        note.CustomerCode = note.Customer?.ScoularId;
        return note;
    }

    public async Task<Note?> UpdateAsync(long noteId, string content, string currentUser, CancellationToken cancellationToken)
    {
        var note = await _appContext.Notes
            .Include(n => n.Customer)
            .FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
        if (note == null)
        {
            return null;
        }

        note.Description = content;
        note.ModifiedBy = currentUser;
        note.ModifiedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Updated note {NoteId}", noteId);
        note.CustomerName = note.Customer?.Name ?? string.Empty;
        note.CustomerCode = note.Customer?.ScoularId;
        return note;
    }

    public async Task DeleteAsync(long noteId, string currentUser, CancellationToken cancellationToken)
    {
        // Soft delete: keep the row, mark IsDeleted/DeletedAt/DeletedBy. Reads filter on
        // !IsDeleted so the user-facing behavior is unchanged, but the record can be
        // recovered later by flipping IsDeleted back to false.
        var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
        if (note == null)
        {
            return;
        }

        note.IsDeleted = true;
        note.DeletedAt = DateTime.UtcNow;
        note.DeletedBy = currentUser;
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Soft-deleted note {NoteId} (DeletedBy={DeletedBy})", noteId, note.DeletedBy);
    }
}
