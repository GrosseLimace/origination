using System.Collections.Concurrent;
using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads contracts live from CTRM - one producer, or the full history of a batch of producers.
/// </summary>
/// <remarks>
/// <para><b>Why this replaces the window snapshot for per-producer reads.</b> The <c>contracts</c> field
/// accepts <c>customerId</c>, and supplying it waives the otherwise-mandatory date range - so a
/// producer's FULL contract history comes back in one query. No window, no warm-up, no truncation, and
/// no 12-hour staleness. Measured warm: 1.4-2.0s including pricing lines.</para>
///
/// <para><b>Why there is still a cache.</b> Selecting a producer triggers three reads that all want the
/// same rows - the contract list, the pricing lines, and the pacing card. Without a cache that is three
/// round trips of identical work; with one it is a single call. The TTL is deliberately short (seconds,
/// not hours) so this stays a request-coalescing device rather than a staleness source: the thing the
/// snapshot got wrong was caching for long enough to be wrong.</para>
///
/// <para><b>Why the in-flight task is shared.</b> Those three reads arrive near-simultaneously, so
/// caching only completed results would still let all three fire. The cache therefore stores the
/// <see cref="Task{TResult}"/> itself, and late arrivals await the call already in progress.</para>
/// </remarks>
public sealed class CtrmContractReader
{
    /// <summary>Page size. 500 is the API's ceiling; a producer almost never exceeds one page.</summary>
    private const int PageSize = 500;

    /// <summary>Safety stop for a single-producer read. More contracts than this for one producer would
    /// mean the filter is not doing what we think, so bail loudly rather than page forever.</summary>
    private const int MaxPages = 20;

    /// <summary>Server-enforced ceiling on the <c>customerIds</c> list.</summary>
    private const int MaxCustomerIdsPerCall = 500;

    /// <summary>Default per-chunk page cap for a batch read - 500 producers' FULL history. Overridable
    /// with <c>Ctrm:TradeUnitContractMaxPagesPerChunk</c>; the log says TRUNCATED when it is hit.</summary>
    private const int DefaultMaxPagesPerChunk = 100;

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmContractReader> _logger;
    private readonly Func<DateTime> _utcNow;

    /// <summary>Cache inserts between sweeps of expired entries. Without one the dictionary only grows.</summary>
    private const int SweepEvery = 64;

    private int _inserts;

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// A cached read. Holds the fetch LAZILY, which is the whole point.
    /// </summary>
    /// <remarks>
    /// The obvious version - <c>new CacheEntry(now, fetch())</c> then <c>TryAdd</c> - starts the request
    /// before the slot is claimed, so concurrent callers that lose the race have already fired an HTTP call
    /// nobody will read. Measured 2026-08-27: selecting a producer issues three near-simultaneous reads for
    /// the same contract list (the contract table, the pacing card, and the open-contract set the ticket read
    /// needs), and the log showed all three hitting CTRM. Deferring the call until a caller actually takes the
    /// entry means the loser's factory never runs.
    /// </remarks>
    private sealed record CacheEntry(DateTime CreatedUtc, Lazy<Task<CtrmReadResult<List<CtrmContractDto>>>> Pending)
    {
        /// <summary>Starts the fetch on first access, then returns the same task to everyone after.</summary>
        public Task<CtrmReadResult<List<CtrmContractDto>>> Read => Pending.Value;

        /// <summary>Whether the fetch has run and finished - without starting it.</summary>
        public bool IsCompleted => Pending.IsValueCreated && Pending.Value.IsCompleted;

        /// <summary>Whether the fetch ran and produced something unusable - without starting it.</summary>
        public bool Failed => IsCompleted
            && (!Pending.Value.IsCompletedSuccessfully || !Pending.Value.Result.Ok);

        /// <summary>
        /// The completed result this entry REPLACED, if it replaced a good one.
        /// </summary>
        /// <remarks>
        /// Stale-while-revalidate is meant to spare every caller the wait, not just the one who happened to
        /// notice the entry had expired. Without this, that first caller got the old copy and then swapped the
        /// in-flight refresh into the slot - so everyone arriving during the refresh found a fresh-looking,
        /// not-yet-complete entry and blocked on it. Carrying the old task forward means they get an answer
        /// immediately too, and only callers arriving after the refresh lands wait for nothing at all.
        /// </remarks>
        public Task<CtrmReadResult<List<CtrmContractDto>>>? Previous { get; init; }

        /// <summary>The best answer available right now: the refreshed one if it has landed, else the copy
        /// this entry replaced.</summary>
        public Task<CtrmReadResult<List<CtrmContractDto>>> BestAvailable =>
            Previous is not null && !IsCompleted ? Previous : Read;

        public static CacheEntry Deferred(
            DateTime CreatedUtc,
            Func<Task<CtrmReadResult<List<CtrmContractDto>>>> fetch,
            Task<CtrmReadResult<List<CtrmContractDto>>>? previous = null) =>
            new(CreatedUtc, new Lazy<Task<CtrmReadResult<List<CtrmContractDto>>>>(fetch, LazyThreadSafetyMode.ExecutionAndPublication))
            { Previous = previous };
    }

    /// <param name="utcNow">Clock, injectable so the cache's time behaviour can be tested. Defaults to
    /// <see cref="DateTime.UtcNow"/>; DI supplies the default because the type is unregistered.</param>
    public CtrmContractReader(
        ICtrmGraphQlClient client,
        IConfiguration configuration,
        ILogger<CtrmContractReader> logger,
        Func<DateTime>? utcNow = null)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
        _utcNow = utcNow ?? (() => DateTime.UtcNow);
    }

    /// <summary>
    /// Every purchase contract CTRM holds for this producer, any date, WITH pricing lines.
    /// </summary>
    /// <remarks>
    /// <para>Only the pricing-line read needs this. Projecting <c>prices</c> roughly doubles the cost of a
    /// contract page - measured 8.1s against 4.0s for a 500-row page, and 0.8-4.0s against 0.25-1.8s for
    /// one producer - and a contract LIST never reads them. The contracts table, the pacing card and the
    /// open-contract set the ticket read needs all use <see cref="GetForProducerCoreAsync"/> instead.</para>
    ///
    /// <para>Concurrent callers for the same producer share one request. The supplied
    /// <paramref name="cancellationToken"/> is deliberately NOT threaded into the shared fetch: one
    /// caller navigating away would otherwise cancel the work the other two are waiting on.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmContractDto>>> GetForProducerFullAsync(
        string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        if (code.Length == 0) return Failed("No producer code supplied.");

        return GetCachedAsync(FullKey(code), LiveTtl(), () => FetchForProducerAsync(code));
    }

    /// <summary>
    /// The same contracts without pricing lines - what every contract LIST actually needs.
    /// </summary>
    /// <remarks>
    /// <para><b>Superset rule.</b> A completed, successful, still-fresh FULL entry already contains
    /// everything core does (<c>CtrmMappings.ToContracts</c> never touches <c>Prices</c>), so it is handed
    /// back rather than paying for a second call. An IN-FLIGHT full read is deliberately NOT awaited: it is
    /// the expensive shape, and waiting 0.8-4.0s for it when core answers in 0.25-1.8s is the trade this
    /// method exists to avoid. Core never satisfies full - it has no prices to give.</para>
    ///
    /// <para>Two cache keys per producer, one per projection. <see cref="Invalidate"/> drops both.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmContractDto>>> GetForProducerCoreAsync(
        string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        if (code.Length == 0) return Failed("No producer code supplied.");

        if (_cache.TryGetValue(FullKey(code), out var full)
            && full.IsCompleted
            && !full.Failed
            && _utcNow() - full.CreatedUtc < LiveTtl())
            return full.Read;

        return GetCachedAsync(CoreKey(code), LiveTtl(), () => FetchProducerCoreAsync(code, interactive: true));
    }

    private static string FullKey(string code) => $"customer:{code}:full";

    private static string CoreKey(string code) => $"customer:{code}:core";

    /// <summary>
    /// Every purchase contract, any date, for a batch of producers - the trade-unit-wide read.
    /// </summary>
    /// <remarks>
    /// <para>This is the ODS flow aimed at CTRM: trade units resolve to producers in Origination, and the
    /// producers come here. It backs the trade-unit-wide contract list, the crop-year list (filtered from
    /// this result in memory) and the open-contract set the trade-unit-wide ticket read needs, so all three
    /// share one cache entry per producer set.</para>
    ///
    /// <para><b>Cache behaviour is the feature.</b> <c>contracts(customerIds:)</c> is ~20-27s cold per chunk
    /// (reported to the API owner) - fine in the background, unacceptable on a click. So the entry is kept
    /// for <c>Ctrm:TradeUnitCacheMinutes</c> and, once it has expired, the NEXT caller is still served the
    /// old copy instantly while a refresh runs behind it. The home-page contract load warms the set, so the
    /// first prompt of a session normally finds it ready. A caller only waits when nothing is cached yet.</para>
    ///
    /// <para><c>customerIds</c> is capped at <see cref="MaxCustomerIdsPerCall"/>, so the set is chunked and
    /// the chunks run at the configured page concurrency. Cost is roughly flat per chunk regardless of how
    /// many codes it carries, so fuller chunks are strictly cheaper.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmContractDto>>> GetForProducersAsync(
        IReadOnlyCollection<string> scoularIds, CancellationToken cancellationToken)
    {
        // Keeps EVERY code: the length limit is a defect in the customerIds argument, not in the data, and
        // the per-producer strategy uses the singular filter which handles a long code fine. The drop now
        // happens inside FetchByCustomerIdsAsync, where it actually applies.
        var codes = CtrmCustomerCodes.NormalizeKeepingAll(scoularIds);

        // An empty producer set is a legitimate question with an empty answer. It must never become an
        // unfiltered query - without customerIds the server would demand a date range and, given one,
        // would return every counterparty in the library.
        if (codes.Count == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmContractDto>> { Status = CtrmReadStatus.Ok, Value = [] });

        // Hashed rather than joined: the key would otherwise be tens of kilobytes for a full trade unit.
        var key = $"producers:{codes.Count}:{StableHash(codes)}";
        var ttl = TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:TradeUnitCacheMinutes", 5)));
        return GetCachedAsync(key, ttl, () => FetchForProducersAsync(codes), staleWhileRevalidate: true);
    }

    /// <summary>True when a producer set is already cached (fresh, stale or in flight) - i.e. a caller
    /// would not have to wait on CTRM. For diagnostics and tests.</summary>
    public bool IsWarm(IReadOnlyCollection<string> scoularIds)
    {
        // Same normalization as GetForProducersAsync, or the key would not match.
        var codes = CtrmCustomerCodes.NormalizeKeepingAll(scoularIds);
        return codes.Count > 0 && _cache.ContainsKey($"producers:{codes.Count}:{StableHash(codes)}");
    }

    /// <summary>
    /// What this reader currently holds for one producer - keys, age and state, never rows.
    /// </summary>
    /// <remarks>
    /// For the timing diagnostics endpoint. A stage time is uninterpretable without knowing whether it was
    /// served from cache, and inferring that from the number is guesswork.
    /// </remarks>
    public IReadOnlyList<string> Describe(string scoularId)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        var now = _utcNow();

        return
        [
            .. new[] { ("core", CoreKey(code)), ("full", FullKey(code)) }
                .Where(k => _cache.ContainsKey(k.Item2))
                .Select(k =>
                {
                    var entry = _cache[k.Item2];
                    var state = !entry.IsCompleted ? "in-flight" : entry.Failed ? "failed" : "ok";
                    return $"{k.Item1}:{state}:{(now - entry.CreatedUtc).TotalSeconds:F1}s";
                })
        ];
    }

    /// <summary>Drops a producer's cached reads - BOTH projections - so the next request goes back to CTRM.</summary>
    public void Invalidate(string scoularId)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        _cache.TryRemove(FullKey(code), out _);
        _cache.TryRemove(CoreKey(code), out _);
    }

    // -------------------------------------------------------------------------

    private List<string> Normalize(IReadOnlyCollection<string>? codes)
    {
        var cleaned = CtrmCustomerCodes.Normalize(codes, out var dropped);

        // A warning, not silence: the producer really is missing from the result. Dropping beats sending,
        // because sending loses the whole chunk instead of one row.
        if (dropped.Count > 0)
            _logger.LogWarning(
                "CTRM contracts: dropped {Count} producer code(s) longer than {Max} characters before querying. " +
                "The customerIds filter answers an internal error rather than an empty match for those, and " +
                "would fail every producer in the same chunk. Codes: {Codes}",
                dropped.Count, CtrmCustomerCodes.MaxLength, string.Join(", ", dropped.Take(10)));

        return cleaned;
    }

    /// <summary>
    /// Order-independent hash of a producer set, for use in a cache key.
    /// </summary>
    /// <remarks>
    /// FNV-1a over the sorted, upper-cased codes. Not security-relevant - a collision would serve one
    /// trade unit's contracts to another, so the count is kept in the key alongside it as a cheap guard.
    /// <see cref="string.GetHashCode()"/> is deliberately avoided: it is randomized per process, which
    /// would be fine here but is a trap for anyone who later persists the key.
    /// </remarks>
    private static string StableHash(IEnumerable<string> codes)
    {
        var hash = 2166136261u;
        foreach (var code in codes)
        {
            foreach (var c in code.ToUpperInvariant())
            {
                hash ^= c;
                hash *= 16777619u;
            }
            hash ^= (byte)',';
            hash *= 16777619u;
        }
        return hash.ToString("x8", CultureInfo.InvariantCulture);
    }

    private static Task<CtrmReadResult<List<CtrmContractDto>>> Failed(string detail)
        => Task.FromResult(new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = CtrmReadStatus.Error,
            Detail = detail,
            Value = []
        });

    private TimeSpan LiveTtl() => TimeSpan.FromSeconds(Math.Max(0, ReadInt("Ctrm:LiveCacheSeconds", 60)));

    /// <param name="staleWhileRevalidate">When true, an EXPIRED but successful entry is handed to the
    /// caller immediately while a refresh starts behind it, so nobody waits on a slow batch read that has
    /// already been answered once. Off for per-producer reads: those are 1-2s and the user has just asked
    /// for that producer, so fresh is worth the wait.</param>
    private Task<CtrmReadResult<List<CtrmContractDto>>> GetCachedAsync(
        string cacheKey, TimeSpan ttl, Func<Task<CtrmReadResult<List<CtrmContractDto>>>> fetch,
        bool staleWhileRevalidate = false)
    {
        while (true)
        {
            var now = _utcNow();

            if (_cache.TryGetValue(cacheKey, out var existing))
            {
                // Reuse while fresh, and never keep a failed read: a transient error should not lock a
                // producer out of the screen until the TTL happens to expire.
                var failed = existing.Failed;

                if (!failed && now - existing.CreatedUtc < ttl)
                    return existing.BestAvailable;

                if (!failed && existing.IsCompleted && staleWhileRevalidate)
                {
                    // Expired but good. Start the refresh, hand this caller the old copy, and carry that copy
                    // on the new entry so callers arriving mid-refresh are served instead of blocking.
                    var fresh = CacheEntry.Deferred(now, fetch, previous: existing.Read);
                    if (_cache.TryUpdate(cacheKey, fresh, existing))
                    {
                        _ = fresh.Read;          // the refresh is the point; nothing else will await it
                        return existing.Read;
                    }
                    continue;   // someone else swapped it first; loop and take theirs
                }

                _cache.TryRemove(cacheKey, out _);
            }

            // GetOrAdd, not TryAdd: a loser's fetch must never start. The factory is deferred until whoever
            // owns the entry reads it.
            var added = CacheEntry.Deferred(now, fetch);
            var actual = _cache.GetOrAdd(cacheKey, added);
            if (ReferenceEquals(actual, added))
            {
                if (Interlocked.Increment(ref _inserts) % SweepEvery == 0) SweepExpired(now);
                return actual.Read;
            }

            if (now - actual.CreatedUtc < ttl || !actual.Failed)
                return actual.BestAvailable;

            // The entry we found is a failed one past its usefulness; drop it and try again.
            _cache.TryRemove(cacheKey, out _);
        }
    }

    /// <summary>
    /// Removes entries nothing can still use.
    /// </summary>
    /// <remarks>
    /// This dictionary had no sweep at all and grew for the life of the process. The grace period matters:
    /// a trade-unit entry past its TTL is exactly what stale-while-revalidate serves while a refresh runs, so
    /// evicting on expiry alone would throw away the copy that keeps Build-a-List responsive.
    /// </remarks>
    private void SweepExpired(DateTime now)
    {
        var grace = TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:TradeUnitCacheMinutes", 5)));
        var liveTtl = LiveTtl();

        foreach (var pair in _cache)
        {
            var age = now - pair.Value.CreatedUtc;
            var keep = pair.Key.StartsWith("producers:", StringComparison.OrdinalIgnoreCase)
                ? grace + grace                      // SWR-eligible: one TTL to be stale, another to be served
                : liveTtl + grace;
            if (pair.Value.IsCompleted && age >= keep)
                _cache.TryRemove(pair.Key, out _);
        }
    }

    private async Task<CtrmReadResult<List<CtrmContractDto>>> FetchForProducerAsync(string scoularId)
    {
        var all = new List<CtrmContractDto>();
        var skip = 0;

        for (var page = 0; page < MaxPages; page++)
        {
            // Interactive: this is the producer screen's own contract read. Announcing it makes the
            // background trade-unit walk stand aside for its duration.
            using var interactive = CtrmTradeUnitThrottle.Interactive();

            // Wrapped in the server-timeout retry like every other CTRM call. This one had no HC0045
            // handling at all, so a server-side timeout here failed the producer's contract list outright
            // even though the identical re-send would have succeeded from the server's cache.
            var result = await CtrmServerTimeoutRetry.RunAsync(
                () => _client.QueryAsync<CtrmContractsResponse>(
                    CtrmQueries.ContractsByCustomer,
                    new
                    {
                        customerId = scoularId,
                        prefix = CtrmMappings.PurchasePrefix,
                        skip,
                        take = PageSize
                    },
                    CancellationToken.None),
                _configuration, _logger, $"contracts page skip={skip} for producer {scoularId}",
                interactive: true);

            if (!result.Ok)
                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = result.Status,
                    HttpStatus = result.HttpStatus,
                    ErrorCode = result.ErrorCode,
                    Detail = $"Live contract read failed for producer {scoularId}: {result.Detail}",
                    Value = []
                };

            var pageData = result.Value?.Contracts;
            if (pageData is null)
                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = CtrmReadStatus.Error,
                    HttpStatus = result.HttpStatus,
                    Detail = $"CTRM returned no contracts object for producer {scoularId}.",
                    Value = []
                };

            all.AddRange(pageData.Items);

            if (pageData.PageInfo?.HasNextPage != true)
            {
                _logger.LogInformation(
                    "CTRM live contracts: {Count} purchase contracts for producer {ScoularId} (all dates, {Pages} page(s)).",
                    all.Count, scoularId, page + 1);

                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = CtrmReadStatus.Ok,
                    HttpStatus = result.HttpStatus,
                    Value = all
                };
            }

            skip += PageSize;
        }

        // Reaching the cap means the server-side customer filter is not narrowing as expected. Loud,
        // because the alternative is a producer silently showing a truncated contract list.
        _logger.LogError(
            "CTRM live contracts TRUNCATED [{ErrorCode}] [{ErrorCategory}]: producer {ScoularId} still had more " +
            "after {MaxPages} pages ({Count} rows). The customerId filter may not be applying.",
            "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", scoularId, MaxPages, all.Count);

        return new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = CtrmReadStatus.PartialSuccess,
            Detail = $"Truncated after {MaxPages} pages ({all.Count} contracts) for producer {scoularId}.",
            Value = all
        };
    }

    /// <summary>
    /// Fans a crop-year read out across producer chunks and pages, all through one concurrency budget.
    /// </summary>
    /// <remarks>
    /// <para>Two phases, for a reason worth stating. Each chunk's first page is fetched to learn its
    /// <c>totalCount</c>; only then is the page count known, which frees every remaining page across every
    /// chunk to run together. Paging sequentially within a chunk instead measured ~8s per 500-row page and
    /// four pages for a single 88-producer chunk - about 32s of mostly idle waiting.</para>
    ///
    /// <para>One shared semaphore covers chunks and pages alike, so the ceiling is a true request ceiling
    /// rather than per-chunk. A 429 from APIM fails the whole read, so headroom matters more than the last
    /// few seconds.</para>
    /// </remarks>
    /// <summary>Strategy name for the fan-out over the indexed singular filter (default).</summary>
    public const string PerProducerStrategy = "perProducer";

    /// <summary>Strategy name for the chunked <c>customerIds</c> list filter - the shape that should win
    /// once the API owner fixes its plan.</summary>
    public const string CustomerIdsStrategy = "customerIds";

    /// <summary>
    /// Full-history read for a producer set, by whichever strategy <c>Ctrm:TradeUnitContractStrategy</c> names.
    /// </summary>
    /// <remarks>
    /// Default is <see cref="PerProducerStrategy"/>, and that is a measured choice, not a preference. On
    /// 2026-08-27 against QA, a 587-producer trade unit: the <c>customerIds</c> path never completed under
    /// load - every page a ~25s server-side scan tripping the server's own 30s limit, retries included -
    /// while 48 singular reads finished in 23s at 8 concurrent (avg 1.5s, max 4.1s, no errors). Hundreds of
    /// cheap indexed calls beat a handful of scans that do not finish. The list path stays one config flip
    /// away because it is the right shape once the server can run it.
    /// </remarks>
    private Task<CtrmReadResult<List<CtrmContractDto>>> FetchForProducersAsync(List<string> codes)
    {
        var strategy = _configuration["Ctrm:TradeUnitContractStrategy"]?.Trim();
        return string.Equals(strategy, CustomerIdsStrategy, StringComparison.OrdinalIgnoreCase)
            ? FetchByCustomerIdsAsync(codes)
            : FetchPerProducerAsync(codes);
    }

    /// <summary>
    /// One indexed <c>customerId</c> read per producer, fanned out at <c>Ctrm:TradeUnitPerProducerConcurrency</c>.
    /// </summary>
    /// <remarks>
    /// <para><b>Behind <see cref="CtrmTradeUnitThrottle"/>, on evidence.</b> The first version of this was
    /// deliberately NOT throttled, reasoning that each call is the same weight as a user's click. That was
    /// wrong: hundreds of them back to back saturate the gateway's throughput, and the per-producer reads a
    /// user was clicking on visibly slowed down while a walk ran. The walk is background work and a click is
    /// not, so the walk now competes for the same bounded pool of background slots as the ticket pages.</para>
    ///
    /// <para>A failed producer is re-read once after a short pause before it fails the whole read. With
    /// hundreds of calls the odds of one transient error are real, and a silently shorter producer list is
    /// worse than an honest failure - but one retry turns most of those into successes.</para>
    /// </remarks>
    private async Task<CtrmReadResult<List<CtrmContractDto>>> FetchPerProducerAsync(List<string> codes)
    {
        var concurrency = Math.Clamp(ReadInt("Ctrm:TradeUnitPerProducerConcurrency", 8), 1, 16);
        using var slot = new SemaphoreSlim(concurrency, concurrency);
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        async Task<(string Code, CtrmReadResult<List<CtrmContractDto>> Read)> One(string code)
        {
            await slot.WaitAsync(CancellationToken.None);
            try
            {
                var read = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => FetchProducerCoreAsync(code, interactive: false));
                if (!read.Ok)
                {
                    await Task.Delay(TimeSpan.FromSeconds(2));
                    read = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => FetchProducerCoreAsync(code, interactive: false));
                }
                return (code, read);
            }
            finally
            {
                slot.Release();
            }
        }

        var results = await Task.WhenAll(codes.Select(One));

        var failure = results.FirstOrDefault(r => !r.Read.Ok);
        if (failure.Code is not null)
            return new CtrmReadResult<List<CtrmContractDto>>
            {
                Status = failure.Read.Status,
                HttpStatus = failure.Read.HttpStatus,
                ErrorCode = failure.Read.ErrorCode,
                Detail = $"Trade-unit contract read failed on one of {codes.Count} producer(s) after a retry: {failure.Read.Detail}",
                Value = []
            };

        var truncated = results.Any(r => r.Read.Status == CtrmReadStatus.PartialSuccess);
        var all = results.SelectMany(r => r.Read.Value ?? []).ToList();

        _logger.LogInformation(
            "CTRM live contracts: {Count} purchase contracts (full history) across {Producers} producer(s) via {Calls} per-producer call(s) in {Seconds}s{Truncated}.",
            all.Count, codes.Count, codes.Count, stopwatch.Elapsed.TotalSeconds.ToString("F0"), truncated ? " - TRUNCATED" : string.Empty);

        return new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = truncated ? CtrmReadStatus.PartialSuccess : CtrmReadStatus.Ok,
            Detail = truncated ? "At least one producer exceeded the per-producer page cap." : null,
            Value = all
        };
    }

    /// <summary>
    /// One producer, core projection, paged to the single-producer cap.
    /// </summary>
    /// <param name="interactive">True when a user is waiting: announces itself so the trade-unit walk
    /// stands aside, and takes the short retry budget. The walk itself passes false - it is already
    /// bounded by <see cref="CtrmTradeUnitThrottle"/> and wants the patient budget.</param>
    private async Task<CtrmReadResult<List<CtrmContractDto>>> FetchProducerCoreAsync(string code, bool interactive)
    {
        var all = new List<CtrmContractDto>();
        var skip = 0;

        for (var page = 0; page < MaxPages; page++)
        {
            using var scope = interactive ? CtrmTradeUnitThrottle.Interactive() : null;

            var result = await CtrmServerTimeoutRetry.RunAsync(
                () => _client.QueryAsync<CtrmContractsResponse>(
                    CtrmQueries.ContractsByCustomerCore,
                    new { customerId = code, prefix = CtrmMappings.PurchasePrefix, skip, take = PageSize },
                    CancellationToken.None),
                _configuration, _logger, $"contracts page skip={skip} for one producer",
                interactive: interactive);

            if (!result.Ok)
                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = result.Status, HttpStatus = result.HttpStatus, ErrorCode = result.ErrorCode,
                    Detail = result.Detail, Value = []
                };

            var pageData = result.Value?.Contracts;
            if (pageData is null)
                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = CtrmReadStatus.Error, HttpStatus = result.HttpStatus,
                    Detail = "CTRM returned no contracts object for a producer.", Value = []
                };

            all.AddRange(pageData.Items);
            if (pageData.PageInfo?.HasNextPage != true)
                return new CtrmReadResult<List<CtrmContractDto>> { Status = CtrmReadStatus.Ok, Value = all };

            skip += PageSize;
        }

        return new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = CtrmReadStatus.PartialSuccess,
            Detail = $"Truncated after {MaxPages} pages for one producer.",
            Value = all
        };
    }

    private async Task<CtrmReadResult<List<CtrmContractDto>>> FetchByCustomerIdsAsync(List<string> allCodes)
    {
        // The length drop belongs HERE, not at the entry point: only this filter has the 7-character limit.
        var codes = Normalize(allCodes);
        if (codes.Count == 0)
            return new CtrmReadResult<List<CtrmContractDto>> { Status = CtrmReadStatus.Ok, Value = [] };

        var chunks = codes.Chunk(MaxCustomerIdsPerCall).ToList();
        // Its own, lower concurrency - NOT the page concurrency the cheap reads use. Every page of a
        // customerIds read is a ~25s server-side scan (measured cold on a quiet gateway: 500 codes 24.7s,
        // 87 codes 21.8s; warm ~1s). Firing five of those at once alongside a ticket walk starved the
        // server past our 110s client timeout, three attempts running - measured 2026-08-27 on 587
        // producers. Two at a time finishes; more does not.
        var concurrency = Math.Clamp(ReadInt("Ctrm:TradeUnitContractConcurrency", 2), 1, 8);
        var maxPagesPerChunk = Math.Max(1, ReadInt("Ctrm:TradeUnitContractMaxPagesPerChunk", DefaultMaxPagesPerChunk));
        using var slot = new SemaphoreSlim(concurrency, concurrency);

        async Task<CtrmReadResult<CtrmPage<CtrmContractDto>>> Fetch(string[] chunk, int skip)
        {
            await slot.WaitAsync(CancellationToken.None);
            try
            {
                return await FetchProducersPageAsync(chunk, skip);
            }
            finally
            {
                slot.Release();
            }
        }

        var firstPages = await Task.WhenAll(chunks.Select(chunk => Fetch(chunk, 0)));

        var failure = firstPages.FirstOrDefault(p => !p.Ok);
        if (failure is not null) return Propagate(failure, codes.Count);

        var pages = new List<CtrmPage<CtrmContractDto>>();
        var rest = new List<Task<CtrmReadResult<CtrmPage<CtrmContractDto>>>>();
        var truncated = false;

        for (var i = 0; i < chunks.Count; i++)
        {
            var page = firstPages[i].Value!;
            pages.Add(page);

            // hasNextPage is authoritative for "is there more", NOT the totalCount arithmetic. The two can
            // disagree - a first page can return every row while totalCount counts something broader - and
            // trusting the arithmetic alone would request a page the server says does not exist.
            if (page.PageInfo?.HasNextPage != true) continue;

            var pagesAvailable = (int)Math.Ceiling(page.TotalCount / (double)PageSize);
            var pagesToFetch = Math.Min(Math.Max(pagesAvailable, 2), maxPagesPerChunk);
            if (pagesAvailable > maxPagesPerChunk) truncated = true;

            for (var p = 1; p < pagesToFetch; p++)
                rest.Add(Fetch(chunks[i], p * PageSize));
        }

        if (rest.Count > 0)
        {
            var restPages = await Task.WhenAll(rest);

            failure = restPages.FirstOrDefault(p => !p.Ok);
            if (failure is not null) return Propagate(failure, codes.Count);

            pages.AddRange(restPages.Select(p => p.Value!));
        }

        var all = pages.SelectMany(p => p.Items).ToList();

        if (truncated)
            _logger.LogError(
                "CTRM trade-unit contracts TRUNCATED [{ErrorCode}] [{ErrorCategory}]: {Producers} producer(s) " +
                "needed more than {MaxPages} pages in at least one chunk ({Count} rows kept). Raise Ctrm:TradeUnitContractMaxPagesPerChunk.",
                "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", codes.Count, maxPagesPerChunk, all.Count);
        else
            _logger.LogInformation(
                "CTRM live contracts: {Count} purchase contracts (full history) across {Producers} producer(s), " +
                "{Chunks} chunk(s), {Pages} page(s).",
                all.Count, codes.Count, chunks.Count, pages.Count);

        return new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = truncated ? CtrmReadStatus.PartialSuccess : CtrmReadStatus.Ok,
            Detail = truncated ? $"Truncated at {maxPagesPerChunk} pages per chunk for {codes.Count} producer(s)." : null,
            Value = all
        };
    }

    private static CtrmReadResult<List<CtrmContractDto>> Propagate(
        CtrmReadResult<CtrmPage<CtrmContractDto>> failure, int producers) => new()
        {
            Status = failure.Status,
            HttpStatus = failure.HttpStatus,
            ErrorCode = failure.ErrorCode,
            Detail = $"Trade-unit contract read failed for {producers} producer(s): {failure.Detail}",
            Value = []
        };

    private async Task<CtrmReadResult<CtrmPage<CtrmContractDto>>> FetchProducersPageAsync(string[] chunk, int skip)
    {
        // Wrapped in the server-timeout retry: a cold page here is 22-25s against a 30s server limit, and the
        // server finishes and caches after answering HC0045, so the re-send succeeds in ~1s.
        // Also behind the process-wide trade-unit throttle, so this walk cannot crowd out the per-producer
        // reads a user is clicking on.
        var result = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => CtrmServerTimeoutRetry.RunAsync(
            () => _client.QueryAsync<CtrmContractsResponse>(
                CtrmQueries.ContractsByCustomers,
                new
                {
                    customerIds = chunk,
                    prefix = CtrmMappings.PurchasePrefix,
                    skip,
                    take = PageSize
                },
                CancellationToken.None),
            _configuration, _logger, $"contracts page skip={skip} for {chunk.Length} producer(s)"));

        if (!result.Ok)
            return new CtrmReadResult<CtrmPage<CtrmContractDto>>
            {
                Status = result.Status,
                HttpStatus = result.HttpStatus,
                ErrorCode = result.ErrorCode,
                Detail = result.Detail
            };

        var page = result.Value?.Contracts;
        if (page is null)
            return new CtrmReadResult<CtrmPage<CtrmContractDto>>
            {
                Status = CtrmReadStatus.Error,
                HttpStatus = result.HttpStatus,
                Detail = $"CTRM returned no contracts object for a {chunk.Length}-producer chunk."
            };

        return new CtrmReadResult<CtrmPage<CtrmContractDto>>
        {
            Status = CtrmReadStatus.Ok,
            HttpStatus = result.HttpStatus,
            Value = page
        };
    }

    /// <summary>
    /// Reads an int setting, falling back when absent or unparseable.
    /// </summary>
    /// <remarks>
    /// Uses the indexer rather than <c>GetValue&lt;int&gt;</c> because that extension lives in
    /// Microsoft.Extensions.Configuration.Binder, which this project does not reference.
    /// </remarks>
    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
}
