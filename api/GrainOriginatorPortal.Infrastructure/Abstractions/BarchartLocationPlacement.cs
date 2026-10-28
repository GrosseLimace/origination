namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// An existing Bid Sheet placement of a BarChart location. The same location may be placed in several
/// trade units — one Bid Sheet row each — so the picker can show "already added in…" and avoid
/// accidental duplicates.
/// </summary>
public record BarchartLocationPlacement
{
    public string LocationKey { get; init; } = string.Empty;

    /// <summary>The Bid Sheet location row id for this placement.</summary>
    public int LocationId { get; init; }

    public string TradeUnitCode { get; init; } = string.Empty;
    public string? GroupName { get; init; }

    /// <summary>Name the originator gave it, which may differ from the vendor's.</summary>
    public string Name { get; init; } = string.Empty;
}
