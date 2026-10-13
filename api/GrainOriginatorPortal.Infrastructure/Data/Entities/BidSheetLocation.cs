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
    public string TradeUnitCode { get; set; } = string.Empty;
    public string? GroupName { get; set; }
    public bool IsScoularFacility { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    public List<BidSheetLocationBid> Bids { get; set; } = [];
}
