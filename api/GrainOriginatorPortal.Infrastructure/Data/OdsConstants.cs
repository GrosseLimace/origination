namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Shared constants for querying the ODS contract/ticket views.
/// </summary>
public static class OdsConstants
{
    /// <summary>
    /// vw_CurrentContracts stores an "open" contract's ClosedDate as the min-date sentinel
    /// (0001-01-01) rather than NULL in some source rows, so "open" means ClosedDate IS NULL
    /// OR ClosedDate &lt;= this sentinel. Used by contract and ticket scoping queries.
    /// </summary>
    public static readonly DateTime OpenClosedDateSentinel = new(1, 1, 1);
}
