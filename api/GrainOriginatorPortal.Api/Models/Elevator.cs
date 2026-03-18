namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Read-only model mapped to ctrm.vw_GNP026 in ODS.
/// All columns nullable since some rows have null values.
/// </summary>
public class Elevator
{
    public string? ElevatorCode { get; set; }
    public string? ElevatorShortName { get; set; }
    public string? ElevatorName { get; set; }
    public string? Address1 { get; set; }
    public string? Address2 { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public decimal? ZipCode { get; set; }
    public string? OurFacility { get; set; }
    public decimal? BushelCapacity { get; set; }
    public string? ElevatorCompanyCode { get; set; }
    public string? ElevatorDivisionCode { get; set; }
    public string? ElevatorLocationCode { get; set; }

    // Populated from dbo.ElevatorCoordinates (not from ODS view)
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
}
