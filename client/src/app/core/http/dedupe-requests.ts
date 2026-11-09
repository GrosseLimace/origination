import { Observable, shareReplay } from 'rxjs';
import { finalize } from 'rxjs/operators';

/**
 * In-flight request deduplication for an API client — prevents duplicate concurrent calls to the same slow
 * endpoint (e.g. from HomeComponent._loadAllData() and DataPreloadService). When a second caller requests the
 * same key while the first is still in flight, they share one HTTP request and both receive the same response.
 * Each client keeps its own map: `private readonly _dedupe = dedupeRequests();`.
 */
export function dedupeRequests(): <T>(key: string, request: Observable<T>) => Observable<T> {
  const inFlight = new Map<string, Observable<unknown>>();

  return <T>(key: string, request: Observable<T>): Observable<T> => {
    const cached = inFlight.get(key);
    if (cached) return cached as Observable<T>;
    // finalize sits UPSTREAM of shareReplay so eviction happens when the underlying HTTP call
    // settles, not when an individual subscriber walks away. The other way round, an unsubscribing
    // caller (DataPreloadService's switchMap on a trade-unit change) deleted the entry while
    // refCount: false kept the real request alive — so switching back before it landed fired a
    // duplicate of the exact call this cache exists to prevent.
    const shared = request.pipe(
      finalize(() => inFlight.delete(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    inFlight.set(key, shared);
    return shared;
  };
}
