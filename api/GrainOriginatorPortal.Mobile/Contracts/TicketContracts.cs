namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>Schema <c>TicketSummary</c> (card #646): count and bushels, no line items.</summary>
public sealed record TicketSummaryDto
{
    public required int TotalTickets { get; init; }
    /// <summary>Null when a ticket cannot be converted (no weight or no pounds-per-bushel factor) — shown as "—".</summary>
    public decimal? TotalBushels { get; init; }
    public required IReadOnlyList<TicketGroupDto> Groups { get; init; }
}

/// <summary>Schema <c>TicketGroup</c>: one per contract the tickets applied to, plus <c>unapplied</c>.</summary>
public sealed record TicketGroupDto
{
    public required string Key { get; init; }
    public long? ContractId { get; init; }
    public string? CommodityCode { get; init; }
    public required int TicketCount { get; init; }
    /// <summary>Net weight ÷ the commodity's pounds per bushel, like the desktop; null when not convertible.</summary>
    public decimal? Bushels { get; init; }
    public DateTime? LastTicketDate { get; init; }
}
