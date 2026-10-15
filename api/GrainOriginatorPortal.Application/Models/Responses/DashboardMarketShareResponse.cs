namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a dashboard market share. Entity-shaped (Decision 1).</summary>
public record DashboardMarketShareResponse
{
    public int Id { get; init; }
    public string TradeUnitKey { get; init; } = string.Empty;
    public string CropCategory { get; init; } = string.Empty;
    public int PlantingYear { get; init; }
    public decimal? MarketSharePct { get; init; }
    public DateTime CreatedAt { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime? ModifiedAt { get; init; }
    public string? ModifiedBy { get; init; }
}
