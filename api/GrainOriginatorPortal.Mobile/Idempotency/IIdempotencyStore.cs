namespace GrainOriginatorPortal.Mobile.Idempotency;

/// <summary>
/// Remembers the response of a completed mobile mutation by (user, clientRequestId) so an offline
/// queue that retries the same request gets the original result instead of a duplicate row.
/// </summary>
public interface IIdempotencyStore
{
    bool TryGet<T>(string userKey, Guid clientRequestId, out T? value) where T : class;

    void Set<T>(string userKey, Guid clientRequestId, T value) where T : class;
}
