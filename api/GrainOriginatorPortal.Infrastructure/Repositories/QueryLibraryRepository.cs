using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class QueryLibraryRepository : IQueryLibraryRepository
{
    private readonly ApplicationDbContext _appContext;

    public QueryLibraryRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    public async Task<IReadOnlyList<QueryLibraryItem>> GetActiveAsync(CancellationToken cancellationToken)
    {
        return await _appContext.QueryLibrary
            .AsNoTracking()
            .Where(q => q.IsActive)
            .OrderBy(q => q.Category)
            .ThenBy(q => q.SortOrder)
            .ThenBy(q => q.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task AddSearchLogAsync(QuerySearchLog log, CancellationToken cancellationToken)
    {
        _appContext.QuerySearchLogs.Add(log);
        await _appContext.SaveChangesAsync(cancellationToken);
    }
}
