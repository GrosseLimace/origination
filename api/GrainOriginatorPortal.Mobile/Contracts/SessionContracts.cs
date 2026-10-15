namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>GET /me — see openapi/mobile/specification.yaml schema <c>Session</c>.</summary>
public sealed record SessionDto
{
    public required string DisplayName { get; init; }
    /// <summary>Every trade unit the caller is entitled to, flat, ordered by code.</summary>
    public required IReadOnlyList<TradeUnitDto> TradeUnits { get; init; }
    /// <summary>The caller's Trade Unit Preferences groups (the first screen of the producer flow).</summary>
    public required IReadOnlyList<TradeUnitGroupDto> Groups { get; init; }
}

/// <summary>Schema <c>TradeUnit</c>. Whether it offers storage is asked separately (<see cref="TradeUnitStorageDto"/>).</summary>
public sealed record TradeUnitDto
{
    public required string Code { get; init; }
    public required string Name { get; init; }
}

/// <summary>Schema <c>TradeUnitStorage</c> (card #648): drives whether the Storage &amp; DP tab exists.</summary>
public sealed record TradeUnitStorageDto
{
    public required string Code { get; init; }
    public required bool OffersStorage { get; init; }
}

/// <summary>Schema <c>TradeUnitGroup</c>: a named group from Trade Unit Preferences and the entitled codes in it.</summary>
public sealed record TradeUnitGroupDto
{
    public required string Name { get; init; }
    public required IReadOnlyList<string> TradeUnitCodes { get; init; }
}
