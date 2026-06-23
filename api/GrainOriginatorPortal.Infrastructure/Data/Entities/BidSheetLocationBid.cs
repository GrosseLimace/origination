using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class BidSheetLocationBid
{
    public int Id { get; set; }
    public int LocationId { get; set; }
    public string CommodityCode { get; set; } = string.Empty;
    public string? CommodityName { get; set; }
    public string? CommodityCategory { get; set; }
    public int CropYear { get; set; }
    public int Month { get; set; } // 0=yearly, 1-12=monthly
    public string Bid { get; set; } = string.Empty;
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    [JsonIgnore]
    public BidSheetLocation Location { get; set; } = null!;
}
