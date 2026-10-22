namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// What the catalog actually holds right now. The picker shows this so an empty search result reads
/// as "we don't pull that state yet" rather than "the feed is broken".
/// </summary>
public record BarchartCoverage
{
    /// <summary>Active, non-test elevator listings in the catalog.</summary>
    public int LocationCount { get; init; }

    /// <summary>When the catalog was last refreshed by a vendor load.</summary>
    public DateTime? LastRefreshedUtc { get; init; }

    /// <summary>Per-state counts, most locations first.</summary>
    public List<BarchartStateCoverage> States { get; init; } = [];
}

/// <summary>One state's share of the catalog.</summary>
public record BarchartStateCoverage
{
    public string State { get; init; } = string.Empty;
    public int LocationCount { get; init; }
}
