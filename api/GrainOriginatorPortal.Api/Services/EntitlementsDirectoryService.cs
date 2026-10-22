using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class EntitlementsDirectoryService : IEntitlementsDirectoryService
{
    private readonly TradeUnitPreferencesDbContext _db;

    public EntitlementsDirectoryService(TradeUnitPreferencesDbContext db)
    {
        _db = db;
    }

    /// <inheritdoc />
    public Task<List<DirectoryAssignment>> GetAssignmentsAsync(string userId, CancellationToken cancellationToken) =>
        _db.UserTradeUnitPreferences
            .AsNoTracking()
            .Where(u => u.UserId == userId)
            .Select(u => new DirectoryAssignment(u.UserId, u.DisplayName, u.TradeUnitCode, u.Description, u.GroupId, u.GroupName))
            .ToListAsync(cancellationToken);

    /// <inheritdoc />
    public Task<List<DirectoryAssignment>> GetColleaguesAsync(
        IReadOnlyCollection<string> tradeUnitCodes, bool activeOnly, CancellationToken cancellationToken)
    {
        // Filtered in SQL so memory is bounded by the caller's overlap, not by the size of the view.
        var codes = tradeUnitCodes.ToList();
        var query = _db.UserTradeUnitPreferences
            .AsNoTracking()
            .Where(u => codes.Contains(u.TradeUnitCode));
        if (activeOnly)
            query = query.Where(u => _db.Users.Any(a => a.UserId == u.UserId && a.IsActive));
        return query
            .Select(u => new DirectoryAssignment(u.UserId, u.DisplayName, u.TradeUnitCode, u.Description, u.GroupId, u.GroupName))
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public Task<List<DirectoryAssignment>> GetGroupAssignmentsAsync(
        IReadOnlyCollection<int> groupIds, CancellationToken cancellationToken)
    {
        var ids = groupIds.Select(id => (int?)id).ToList();
        return _db.UserTradeUnitPreferences
            .AsNoTracking()
            .Where(u => ids.Contains(u.GroupId))
            .Select(u => new DirectoryAssignment(u.UserId, u.DisplayName, u.TradeUnitCode, u.Description, u.GroupId, u.GroupName))
            .ToListAsync(cancellationToken);
    }
}
