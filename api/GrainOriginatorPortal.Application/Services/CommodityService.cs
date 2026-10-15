using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class CommodityService : ICommodityService
{
    private readonly ICommodityRepository _repository;
    private readonly IMemoryCache _cache;

    public CommodityService(ICommodityRepository repository, IMemoryCache cache)
    {
        _repository = repository;
        _cache = cache;
    }

    /// <inheritdoc />
    public Task<List<CommodityResponse>> GetAllAsync(CancellationToken cancellationToken) =>
        GetCachedAsync("commodities:active", TimeSpan.FromMinutes(10),
            async ct => (await _repository.GetActiveAsync(ct)).Select(c => c.ToResponse()).ToList(),
            cancellationToken);

    /// <inheritdoc />
    public Task<List<CommodityResponse>> GetPlantingAsync(CancellationToken cancellationToken) =>
        GetCachedAsync("commodities:planting", TimeSpan.FromMinutes(10),
            async ct => (await _repository.GetPlantingAsync(ct)).Select(c => c.ToResponse()).ToList(),
            cancellationToken);

    /// <inheritdoc />
    public Task<List<CommodityConversionResponse>> GetConversionsAsync(CancellationToken cancellationToken) =>
        GetCachedAsync("commodity-conversions", TimeSpan.FromHours(1),
            async ct => (await _repository.GetConversionsAsync(ct)).Select(c => c.ToResponse()).ToList(),
            cancellationToken);

    /// <inheritdoc />
    public Task<List<HarvestWindowResponse>> GetHarvestWindowsAsync(CancellationToken cancellationToken) =>
        GetCachedAsync("harvest-windows", TimeSpan.FromHours(1),
            async ct => (await _repository.GetHarvestWindowsAsync(ct)).Select(h => h.ToResponse()).ToList(),
            cancellationToken);

    /// <summary>Cache-aside helper: return the cached list or compute, cache (size 1), and return it.</summary>
    private async Task<List<T>> GetCachedAsync<T>(string cacheKey, TimeSpan ttl,
        Func<CancellationToken, Task<List<T>>> factory, CancellationToken cancellationToken)
    {
        if (_cache.TryGetValue(cacheKey, out List<T>? cached) && cached is not null)
            return cached;

        var result = await factory(cancellationToken);
        _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = ttl,
            Size = 1
        });
        return result;
    }
}
