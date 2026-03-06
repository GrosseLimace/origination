using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models;

public class UpsertDashboardActualHarvestRequest
{
    [Required][StringLength(50)]  public string TradeUnitKey { get; set; } = string.Empty;
    [Required][StringLength(50)]  public string CropCategory { get; set; } = string.Empty;
    [Range(2000, 2100)]           public int PlantingYear { get; set; }
    [Range(0, int.MaxValue)]      public int Bushels { get; set; }
}
