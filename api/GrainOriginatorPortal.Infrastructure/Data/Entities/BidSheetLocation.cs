namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class BidSheetLocation
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public string? ElevatorCode { get; set; }

    /// <summary>
    /// BarChart location listing this row is linked to (barchart.Instrument.LocationKey).
    /// NULL = a normal manually managed location. The same key may appear in multiple trade
    /// units — one row per trade-unit placement.
    /// </summary>
    public string? BarchartLocationKey { get; set; }

    /// <summary>
    /// The trade unit whose desk first added this location. **Provenance only — not a scoping key.**
    ///
    /// A location used to belong to a trade unit, and the same elevator was stored once per trade unit
    /// so each desk had its own row and its own bids. Locations are global now: one row per real
    /// elevator, one shared set of bids, visible to everyone. Nothing reads this to decide what a user
    /// may see or change.
    ///
    /// Kept because the BarChart picker still reports which desks have placed a listing, and because
    /// knowing who introduced a row is worth having. Nullable so a location added without a desk in
    /// view is legal.
    /// </summary>
    public string? TradeUnitCode { get; set; }
    public string? GroupName { get; set; }
    public bool IsScoularFacility { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    public List<BidSheetLocationBid> Bids { get; set; } = [];
}
