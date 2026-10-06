namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// One source row for the customer sync, shaped exactly like an <c>originations.vw_CustomerTradeUnits</c>
/// row: a customer id, one trade unit, and the customer's attributes. A customer with several trade
/// units appears once per trade unit; the sync collapses to the first row per id for the customer upsert.
/// </summary>
public sealed class CustomerSyncSourceRow
{
    public required long CustomerId { get; init; }

    /// <summary>
    /// Trimmed on the CTRM feeder; null = customer-presence-only row. The ODS feeder passes the view's
    /// value verbatim (as the sync has always read it), so blank values can occur there and are skipped
    /// by the trade-unit passes exactly as before.
    /// </summary>
    public required string? TradeUnit { get; init; }

    public required CustomerSyncAttributes Attributes { get; init; }
}
