namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// What a proposed deactivation cutoff would actually do. Checked before anything is switched off,
/// because the vendor sweep is sharded across several days: on any single day only a fraction of the
/// catalog is re-seen, so a cutoff chosen as "yesterday" would retire almost the whole book.
/// </summary>
public record BarchartDeactivationImpact
{
    /// <summary>Active, non-test instruments before the cutoff is applied.</summary>
    public int ActiveCount { get; init; }

    /// <summary>How many of those the cutoff would switch off.</summary>
    public int WouldDeactivate { get; init; }

    /// <summary>Share of the active catalog the cutoff would switch off, 0-100.</summary>
    public double SharePercent => ActiveCount == 0 ? 0 : Math.Round(WouldDeactivate * 100.0 / ActiveCount, 1);
}
