using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Commodity reference data: full list, the curated planting-intentions subset,
/// unit conversions, and harvest windows. Results are short-lived cached.</summary>
public interface ICommodityService
{
    Task<List<CommodityResponse>> GetAllAsync(CancellationToken cancellationToken);
    Task<List<CommodityResponse>> GetPlantingAsync(CancellationToken cancellationToken);
    Task<List<CommodityConversionResponse>> GetConversionsAsync(CancellationToken cancellationToken);
    Task<List<HarvestWindowResponse>> GetHarvestWindowsAsync(CancellationToken cancellationToken);
}
