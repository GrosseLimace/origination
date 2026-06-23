using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class DisplayNameLookupRepository : IDisplayNameLookupRepository
{
    private readonly ApplicationDbContext _appContext;

    public DisplayNameLookupRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    public async Task<Dictionary<string, string>> ResolveAsync(IEnumerable<string> userIds, CancellationToken cancellationToken)
    {
        var distinct = userIds
            .Where(u => !string.IsNullOrEmpty(u))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (distinct.Count == 0) return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        // Snapshot stores the left-of-@ portion, so match by the short form.
        var shortForms = distinct.Select(v =>
        {
            var at = v.IndexOf('@');
            return at > 0 ? v[..at] : v;
        }).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var rows = await _appContext.UserTradeUnitSnapshots
            .AsNoTracking()
            .Where(u => shortForms.Contains(u.UserId))
            .Select(u => new { u.UserId, u.DisplayName })
            .Distinct()
            .ToListAsync(cancellationToken);

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows.GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase))
        {
            var displayName = r.First().DisplayName;
            // Register the short form so direct lookups work
            map[r.Key] = displayName;
            // Also register every full-UPN form that came in for this short form so callers
            // passing "CEgr@scoular.com" or "cegr@scoular.com" both resolve.
            foreach (var full in distinct)
            {
                var at = full.IndexOf('@');
                var shortForm = at > 0 ? full[..at] : full;
                if (shortForm.Equals(r.Key, StringComparison.OrdinalIgnoreCase))
                {
                    map[full] = displayName;
                }
            }
        }
        return map;
    }
}
