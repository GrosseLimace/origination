using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Cached elevator data from ctrm.vw_GNP026 stored in Origination DB.
/// Avoids cross-database queries (not supported in Azure SQL).
/// </summary>
[Table("ElevatorCache")]
public class ElevatorCache
{
    [Key]
    [MaxLength(50)]
    public string ElevatorCode { get; set; } = "";

    [MaxLength(100)]
    public string? ElevatorShortName { get; set; }

    [MaxLength(200)]
    public string? ElevatorName { get; set; }

    [MaxLength(300)]
    public string? Address { get; set; }

    [MaxLength(100)]
    public string? City { get; set; }

    [MaxLength(10)]
    public string? State { get; set; }

    [MaxLength(20)]
    public string? ZipCode { get; set; }

    [MaxLength(1)]
    public string? OurFacility { get; set; }

    [MaxLength(50)]
    public string? TradeUnitCode { get; set; }

    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime LastRefreshedAt { get; set; } = DateTime.UtcNow;
}
