using GrainOriginatorPortal.Api.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace GrainOriginatorPortal.Mobile.Storage;

/// <summary>
/// Card #648: does a trade unit offer storage? Nothing records that fact, so it is derived from the data
/// (user decision 2026-10-14): a trade unit offers storage when any of its producers has a DP contract or a
/// storage receipt. <see cref="MobileOptions.StorageTradeUnits"/> still forces "yes" for a trade unit
/// (for example one whose programme is new and has no rows yet).
/// </summary>
public interface ITradeUnitStorageLookup
{
    Task<bool> OffersStorageAsync(string tradeUnit, CancellationToken cancellationToken);
}

/// <remarks>
/// Both reads are trade-unit wide and the storage view is slow, so answers are cached per trade unit.
/// "Yes" is kept for 12 hours. "No" is kept for only 1 hour because the underlying reads log and return an
/// empty list on failure, which is indistinguishable from "none" — a failed read must not hide the tab for
/// half a day. DP is checked first: its rows carry the trade unit and it is the cheaper read.
/// </remarks>
public sealed class TradeUnitStorageLookup : ITradeUnitStorageLookup
{
    internal static readonly TimeSpan YesLifetime = TimeSpan.FromHours(12);
    internal static readonly TimeSpan NoLifetime = TimeSpan.FromHours(1);

    private readonly IDpContractService _dpContracts;
    private readonly IStoredGrainService _storedGrain;
    private readonly IMemoryCache _cache;
    private readonly IOptions<MobileOptions> _options;
    private readonly ILogger<TradeUnitStorageLookup> _logger;

    public TradeUnitStorageLookup(
        IDpContractService dpContracts,
        IStoredGrainService storedGrain,
        IMemoryCache cache,
        IOptions<MobileOptions> options,
        ILogger<TradeUnitStorageLookup> logger)
    {
        _dpContracts = dpContracts;
        _storedGrain = storedGrain;
        _cache = cache;
        _options = options;
        _logger = logger;
    }

    public async Task<bool> OffersStorageAsync(string tradeUnit, CancellationToken cancellationToken)
    {
        if (_options.Value.StorageTradeUnits.Contains(tradeUnit, StringComparer.OrdinalIgnoreCase))
            return true;

        var key = "mobile:offers-storage:" + tradeUnit.ToUpperInvariant();
        if (_cache.TryGetValue(key, out bool cached))
            return cached;

        var tradeUnits = new[] { tradeUnit };
        var offers = (await _dpContracts.GetAllAsync(tradeUnits, cancellationToken)).Count > 0
            || (await _storedGrain.GetAllAsync(tradeUnits, cancellationToken)).Count > 0;

        // The host cache has a SizeLimit, so every entry must declare a size.
        _cache.Set(key, offers, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = offers ? YesLifetime : NoLifetime,
            Size = 1,
        });
        _logger.LogInformation("Trade unit {TradeUnit} offers storage: {OffersStorage} (derived from DP and storage rows).", tradeUnit, offers);
        return offers;
    }
}
