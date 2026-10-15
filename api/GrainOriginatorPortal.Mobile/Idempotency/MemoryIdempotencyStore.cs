using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Mobile.Idempotency;

/// <summary>
/// In-memory <see cref="IIdempotencyStore"/> backed by the host's <see cref="IMemoryCache"/>.
/// <para>
/// INTERIM. It de-duplicates retries within one App Service instance for 24 hours, which covers the
/// offline-queue replay case in Dev. It does not survive a restart or span instances. The durable
/// design is a <c>ClientRequestId</c> column with a unique index per (CreatedBy, ClientRequestId) on
/// the writable tables (Notes, ProducerDetails, PlantingIntentions), added in its own migration once
/// the offline-depth decision (MEETING-QUESTIONS.md Q3) is made. Tracked in MOBILE-ARCHITECTURE-PLAN.md.
/// </para>
/// </summary>
public sealed class MemoryIdempotencyStore : IIdempotencyStore
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    private readonly IMemoryCache _cache;

    public MemoryIdempotencyStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public bool TryGet<T>(string userKey, Guid clientRequestId, out T? value) where T : class
    {
        if (_cache.TryGetValue(Key(userKey, clientRequestId), out var cached) && cached is T typed)
        {
            value = typed;
            return true;
        }

        value = null;
        return false;
    }

    public void Set<T>(string userKey, Guid clientRequestId, T value) where T : class
    {
        // The host cache has a SizeLimit, so every entry must declare a size.
        _cache.Set(Key(userKey, clientRequestId), value, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = Lifetime,
            Size = 1,
        });
    }

    private static string Key(string userKey, Guid clientRequestId) => $"mobile-idem:{userKey}:{clientRequestId:N}";
}
