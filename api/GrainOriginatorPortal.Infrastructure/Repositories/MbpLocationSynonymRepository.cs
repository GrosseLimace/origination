using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <inheritdoc />
public class MbpLocationSynonymRepository : IMbpLocationSynonymRepository
{
    private readonly ApplicationDbContext _appContext;

    public MbpLocationSynonymRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    /// <inheritdoc />
    public async Task<Dictionary<string, string>> GetDisplayNamesByLocationIdsAsync(
        IEnumerable<string> locationIds, CancellationToken cancellationToken)
    {
        var distinct = locationIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (distinct.Count == 0) return map;

        var rows = await _appContext.MbpLocationSynonyms
            .AsNoTracking()
            .Where(m => distinct.Contains(m.LocationId) && m.DisplayName != null)
            .Select(m => new { m.LocationId, m.DisplayName })
            .ToListAsync(cancellationToken);

        foreach (var r in rows)
            if (!string.IsNullOrWhiteSpace(r.DisplayName))
                map[r.LocationId.Trim()] = r.DisplayName!.Trim();

        return map;
    }
}
