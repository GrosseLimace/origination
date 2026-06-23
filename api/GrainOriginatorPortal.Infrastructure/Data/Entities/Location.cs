namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Read-only model mapped to ctrm.vw_GNP003 in ODS. Used as a fallback for
/// ticket location lookups when the ticket has no ElevatorCode — the ticket's
/// OrganizationCode is matched against Location_Code to surface city/state.
/// </summary>
public class Location
{
    public string? LocationCode { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
}
