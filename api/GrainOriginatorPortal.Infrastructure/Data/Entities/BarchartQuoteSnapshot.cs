namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Daily price history — one row per instrument per business date, never overwritten across days.
///
/// This is the one table that cannot be backfilled later: the vendor's API returns only <em>current</em>
/// prices, so any day we don't capture is gone for good. Nothing in the app reads it yet; it exists so
/// future trend/comparison reporting is possible without buying the vendor's history product.
///
/// Keyed on (<see cref="SnapshotDate"/>, <see cref="Symbol"/>) so a same-day re-load replaces that
/// day's row rather than duplicating it — which is what makes the ingest endpoints safely retryable.
/// </summary>
public class BarchartQuoteSnapshot
{
    /// <summary>Central-time business date the price was captured for (part of the composite key).</summary>
    public DateOnly SnapshotDate { get; set; }

    /// <summary>Instrument symbol (part of the composite key; foreign key to <see cref="BarchartInstrument"/>).</summary>
    public string Symbol { get; set; } = string.Empty;

    /// <summary>That day's posted bid in $/bu.</summary>
    public decimal? LastPrice { get; set; }

    public decimal? NetChange { get; set; }

    /// <summary>When the elevator last updated the bid as of that capture, stored UTC — records how fresh the day's value actually was.</summary>
    public DateTime? TradeTimestamp { get; set; }

    public DateTime CreatedAtUtc { get; set; }
}
