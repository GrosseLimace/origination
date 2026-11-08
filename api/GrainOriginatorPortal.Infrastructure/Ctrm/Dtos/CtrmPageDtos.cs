namespace GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

/// <summary>Standard page wrapper the CTRM API puts around every collection root field.</summary>
/// <remarks>
/// <see cref="TotalCount"/> is the count for the whole date window, not the page — it is the only
/// way to tell whether a snapshot got truncated, so the snapshot loader reports it.
/// </remarks>
public sealed class CtrmPage<T>
{
    public int TotalCount { get; set; }
    public CtrmPageInfo? PageInfo { get; set; }
    public List<T> Items { get; set; } = [];
}

public sealed class CtrmPageInfo
{
    public int Skip { get; set; }
    public int Take { get; set; }
    public bool HasNextPage { get; set; }
    public bool HasPreviousPage { get; set; }
}
