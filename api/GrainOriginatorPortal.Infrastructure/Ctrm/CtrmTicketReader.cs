using System.Collections.Concurrent;
using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads tickets live from CTRM - by producer or by contract - with a two-level shared cache.
/// </summary>
/// <remarks>
/// <para><b>Why this still needs date windows when contracts do not.</b> <c>tickets</c> accepts
/// <c>customerId</c> and <c>contractNumbers</c>, but unlike <c>contracts</c> it will not waive the date
/// range for either, and the range is capped at <see cref="CtrmQueries.MaxTicketRangeDays"/>. That is
/// structural rather than arbitrary: the ticket header carries neither a customer nor a contract - both
/// live on the detail rows - so each filter is an EXISTS semi-join and the range is what keeps the header
/// scan bounded. A longer lookback is therefore sliced into consecutive windows.</para>
///
/// <para><b>Two cache levels, with different jobs.</b> The OUTER entry is the whole read for one
/// producer or contract set, kept for <c>Ctrm:LiveCacheSeconds</c> - a request-coalescing device, so the
/// full-list and unapplied-subset calls that arrive together become one read. Beneath it, each WINDOW is
/// cached on its own, and its lifetime depends on its age: the window containing today keeps the short
/// TTL, while a window that ended in the past is kept for <c>Ctrm:HistoricalTicketCacheMinutes</c>.
/// Measured against QA the current-year window is ~0.3-0.8s but each older year is ~0.8-2.6s, and older
/// tickets change rarely, so this turns a repeat visit from three requests into the one cheap one.</para>
///
/// <para>Failures are never cached at either level, and the in-flight <see cref="Task{TResult}"/> is what
/// is stored, so late arrivals await the call already in progress rather than starting their own.</para>
/// </remarks>
public sealed class CtrmTicketReader
{
    private const int PageSize = 500;

    /// <summary>Per-window page cap for INTERACTIVE reads. A single producer exceeding this in one window
    /// would mean the filter is not applying.</summary>
    private const int MaxPagesPerWindow = 10;

    /// <summary>Default per-window page cap for the trade-unit-wide read, where a 500-producer chunk
    /// legitimately runs to tens of thousands of rows in one window. Overridable with
    /// <c>Ctrm:TradeUnitTicketMaxPagesPerWindow</c>.</summary>
    private const int DefaultTradeUnitMaxPagesPerWindow = 200;

    /// <summary>How many cache inserts between sweeps of expired entries. The dictionary otherwise only
    /// ever grows: entries expire logically but nothing removed them.</summary>
    private const int SweepEvery = 64;

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmTicketReader> _logger;
    private readonly Func<DateTime> _utcNow;

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);
    private int _inserts;

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
    private sealed record CacheEntry(DateTime ExpiresUtc, Lazy<Task<CtrmReadResult<List<CtrmTicketDto>>>> Pending)
    {
        /// <summary>Starts the fetch on first access, then returns the same task to everyone after.</summary>
        public Task<CtrmReadResult<List<CtrmTicketDto>>> Read => Pending.Value;

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
        public Task<CtrmReadResult<List<CtrmTicketDto>>>? Previous { get; init; }

        /// <summary>The best answer available right now: the refreshed one if it has landed, else the copy
        /// this entry replaced.</summary>
        public Task<CtrmReadResult<List<CtrmTicketDto>>> BestAvailable =>
            Previous is not null && !IsCompleted ? Previous : Read;

        public static CacheEntry Deferred(
            DateTime ExpiresUtc,
            Func<Task<CtrmReadResult<List<CtrmTicketDto>>>> fetch,
            Task<CtrmReadResult<List<CtrmTicketDto>>>? previous = null) =>
            new(ExpiresUtc, new Lazy<Task<CtrmReadResult<List<CtrmTicketDto>>>>(fetch, LazyThreadSafetyMode.ExecutionAndPublication))
            { Previous = previous };
    }

    /// <summary>Which server-side filter a read is using, for cache keys, variables and log lines.</summary>
    private sealed record Scope(string CacheKey, string Description, string Document, object Filter);

    /// <param name="utcNow">Clock, injectable so the cache's time behaviour can be tested. Defaults to
    /// <see cref="DateTime.UtcNow"/>; DI supplies the default because the type is unregistered.</param>
    public CtrmTicketReader(
        ICtrmGraphQlClient client,
        IConfiguration configuration,
        ILogger<CtrmTicketReader> logger,
        Func<DateTime>? utcNow = null)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
        _utcNow = utcNow ?? (() => DateTime.UtcNow);
    }

    /// <summary>
    /// This producer's tickets across the configured lookback, newest window first.
    /// </summary>
    /// <remarks>
    /// The lookback defaults to three years, matching the ODS cutoff. Each additional 366 days is one more
    /// parallel window and roughly another second, so widen <c>Ctrm:TicketLookbackDays</c> deliberately.
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducerAsync(
        string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        if (code.Length == 0) return Failed("No producer code supplied.");

        return GetCachedAsync(new Scope(
            CacheKey: $"customer:{code}",
            Description: $"producer {code}",
            Document: CtrmQueries.TicketsByCustomer,
            Filter: new { customerId = code }));
    }

    /// <summary>
    /// Every ticket applied to the given contract numbers, whichever producer each is booked under.
    /// </summary>
    /// <remarks>
    /// <para>Scoped on the contract rather than the producer, which is the only way to see a split load -
    /// a ticket against one of these contracts booked under a different customer code. Contract numbers
    /// are sorted into the cache key so callers that build the same set in a different order share a read.</para>
    ///
    /// <para>Bounded by the same lookback as the producer read, because the date range is mandatory here
    /// too. A caller needing tickets older than the lookback has to widen it for both.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForContractsAsync(
        IReadOnlyCollection<string> contractNumbers, CancellationToken cancellationToken)
    {
        var numbers = (contractNumbers ?? [])
            .Select(n => n?.Trim())
            .Where(n => !string.IsNullOrEmpty(n))
            .Select(n => n!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // An empty set is a legitimate question with an empty answer - a producer with no open contracts
        // has no applied tickets - so it must never become an unfiltered query.
        if (numbers.Count == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = CtrmReadStatus.Ok,
                Value = []
            });

        return GetCachedAsync(new Scope(
            CacheKey: $"contracts:{string.Join(',', numbers)}",
            Description: numbers.Count == 1 ? $"contract {numbers[0]}" : $"{numbers.Count} contracts",
            Document: CtrmQueries.TicketsByContractNumbers,
            Filter: new { contractNumbers = numbers }));
    }

    /// <summary>
    /// Tickets for a batch of producers over a single bill-of-lading window.
    /// </summary>
    /// <remarks>
    /// <para>Backs the recent-unapplied read behind Spot Loads. Deliberately ONE window rather than the
    /// sliced lookback the per-producer read uses: the cost of a ticket query is the header scan, not the
    /// rows, so a 30-day question costs about the same few seconds as a one-day one - measured 6.1s for 76
    /// rows across 88 producers - while three years of it is roughly a thousand pages.</para>
    ///
    /// <para>Chunked to the <c>customerIds</c> cap. Chunks run concurrently; each is a single page in
    /// practice, and the page cap still applies if a window turns out to be busier than expected.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducersAsync(
        IReadOnlyCollection<string> scoularIds, DateTime from, DateTime to, CancellationToken cancellationToken)
    {
        var codes = CtrmCustomerCodes.Normalize(scoularIds, out var dropped);

        if (dropped.Count > 0)
            _logger.LogWarning(
                "CTRM tickets: dropped {Count} producer code(s) longer than {Max} characters before querying. " +
                "The customerIds filter answers an internal error rather than an empty match for those, and " +
                "would fail every producer in the same chunk. Codes: {Codes}",
                dropped.Count, CtrmCustomerCodes.MaxLength, string.Join(", ", dropped.Take(10)));

        // An empty set must never become an unfiltered query - that would scan the window for every
        // counterparty in the library rather than returning nothing.
        if (codes.Count == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = [] });

        var span = (to.Date - from.Date).TotalDays;
        if (span > CtrmQueries.MaxTicketRangeDays)
            return Failed($"A bill-of-lading range of {span:F0} days exceeds the server's "
                        + $"{CtrmQueries.MaxTicketRangeDays}-day cap; narrow the window or slice it.");

        var key = $"producers:{from:yyyy-MM-dd}:{to:yyyy-MM-dd}:{codes.Count}:{StableHash(codes)}";
        return GetCachedAsync(key, LiveTtl(), () => FetchChunkedAsync(codes, from, to, MaxPagesPerWindow));
    }

    /// <summary>
    /// Every ticket over the configured lookback for a batch of producers - the trade-unit-wide read.
    /// </summary>
    /// <remarks>
    /// <para>This is the ODS flow aimed at CTRM: the trade units resolve to producers in Origination and the
    /// producers come here. It backs every Build-a-List prompt that mentions tickets, deliveries, unapplied
    /// or unsettled. The lookback is sliced into windows inside the server's cap, and each window is its own
    /// cache entry with an age-scaled lifetime - the window containing today keeps the short TTL because
    /// that is where new tickets land; older windows are kept for <c>Ctrm:HistoricalTicketCacheMinutes</c>.</para>
    ///
    /// <para><b>Nobody waits on a refresh.</b> An expired window is served as-is to the caller while a refresh
    /// runs behind it (stale-while-revalidate), so a prompt run a minute after the last one is instant and the
    /// run after that sees the update. A caller only waits when a window has never been read - and the
    /// home-page contract load kicks this read for the same producers, so that is normally already done by
    /// the time a prompt is typed.</para>
    ///
    /// <para>Cost: for a mid-size trade unit (300 producers) roughly 15-40 pages of 500 rows at 3-5s each,
    /// run at the configured concurrency - tens of seconds cold, instant warm. All tickets, not
    /// <c>unappliedOnly</c>: the delivered and unsettled prompts depend on the applied half.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducersHistoryAsync(
        IReadOnlyCollection<string> scoularIds, CancellationToken cancellationToken)
    {
        var codes = CtrmCustomerCodes.Normalize(scoularIds, out var dropped);

        if (dropped.Count > 0)
            _logger.LogWarning(
                "CTRM tickets: dropped {Count} producer code(s) longer than {Max} characters before querying. Codes: {Codes}",
                dropped.Count, CtrmCustomerCodes.MaxLength, string.Join(", ", dropped.Take(10)));

        if (codes.Count == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = [] });

        return FetchHistoryForProducersAsync(codes);
    }

    /// <summary>True when every window for this producer set is cached (fresh, stale or in flight) - i.e. a
    /// caller would not have to wait on CTRM. For diagnostics and tests.</summary>
    public bool IsWarm(IReadOnlyCollection<string> scoularIds)
    {
        var codes = CtrmCustomerCodes.Normalize(scoularIds, out _);
        if (codes.Count == 0) return false;
        var setKey = $"{codes.Count}:{StableHash(codes)}";
        return BuildWindows(DateTime.Today, Math.Max(1, ReadInt("Ctrm:TicketLookbackDays", 1095)))
            .All(w => _cache.ContainsKey($"producers:{w.From:yyyy-MM-dd}:{w.To:yyyy-MM-dd}:{setKey}"));
    }

    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchHistoryForProducersAsync(List<string> codes)
    {
        var lookbackDays = Math.Max(1, ReadInt("Ctrm:TicketLookbackDays", 1095));
        var today = DateTime.Today;
        var windows = BuildWindows(today, lookbackDays);
        var maxPages = Math.Max(1, ReadInt("Ctrm:TradeUnitTicketMaxPagesPerWindow", DefaultTradeUnitMaxPagesPerWindow));
        var setKey = $"{codes.Count}:{StableHash(codes)}";

        // Same key shape as the single-window read above, so a Spot Loads window and a history window over
        // the same producers and dates would share an entry - they are the same rows.
        var results = await Task.WhenAll(windows.Select(w => GetCachedAsync(
            $"producers:{w.From:yyyy-MM-dd}:{w.To:yyyy-MM-dd}:{setKey}",
            TtlForWindow(w.To, today),
            () => FetchChunkedAsync(codes, w.From, w.To, maxPages),
            staleWhileRevalidate: true)));

        // Any window failing makes the whole answer incomplete. Reporting the first failure rather than
        // silently returning a partial list keeps an outage from looking like a trade unit with no tickets.
        var failure = results.FirstOrDefault(r => !r.Ok);
        if (failure is not null)
            return new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = failure.Status,
                HttpStatus = failure.HttpStatus,
                ErrorCode = failure.ErrorCode,
                Detail = failure.Detail,
                Value = []
            };

        var truncated = results.FirstOrDefault(r => r.Status == CtrmReadStatus.PartialSuccess);
        var all = results.SelectMany(r => r.Value ?? []).ToList();

        _logger.LogInformation(
            "CTRM live tickets: {Count} tickets for {Producers} producer(s) across {Windows} window(s) ({Days}-day lookback){Truncated}.",
            all.Count, codes.Count, windows.Count, lookbackDays, truncated is null ? string.Empty : " - TRUNCATED");

        return new CtrmReadResult<List<CtrmTicketDto>>
        {
            Status = truncated is null ? CtrmReadStatus.Ok : CtrmReadStatus.PartialSuccess,
            Detail = truncated?.Detail,
            Value = all
        };
    }

    /// <summary>
    /// What this reader currently holds for one producer - keys, age and state, never rows.
    /// </summary>
    /// <remarks>
    /// For the timing diagnostics endpoint; see the contract reader's equivalent. Windows are listed
    /// individually because a per-producer read is only as fast as its slowest window, and which windows
    /// were already cached is the whole explanation for a fast or slow number.
    /// </remarks>
    public IReadOnlyList<string> Describe(string scoularId)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        var prefix = $"customer:{code}";
        var now = _utcNow();

        return
        [
            .. _cache
                .Where(pair => pair.Key.Equals(prefix, StringComparison.OrdinalIgnoreCase)
                            || pair.Key.StartsWith(prefix + "|", StringComparison.OrdinalIgnoreCase))
                .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .Select(pair =>
                {
                    var state = !pair.Value.IsCompleted ? "in-flight" : pair.Value.Failed ? "failed" : "ok";
                    var expiresIn = (pair.Value.ExpiresUtc - now).TotalSeconds;
                    var label = pair.Key.Length > prefix.Length ? pair.Key[(prefix.Length + 1)..] : "scope";
                    return $"{label}:{state}:expires in {expiresIn:F0}s";
                })
        ];
    }

    /// <summary>Drops a producer's cached read, including every window beneath it.</summary>
    public void Invalidate(string scoularId)
    {
        var prefix = $"customer:{scoularId?.Trim() ?? string.Empty}";
        foreach (var key in _cache.Keys)
            if (key.Equals(prefix, StringComparison.OrdinalIgnoreCase)
                || key.StartsWith(prefix + "|", StringComparison.OrdinalIgnoreCase))
                _cache.TryRemove(key, out _);
    }

    /// <summary>
    /// Order-independent hash of a producer set, for use in a cache key.
    /// </summary>
    /// <remarks>
    /// FNV-1a over the sorted, upper-cased codes. The count is kept in the key beside it as a cheap guard,
    /// because a collision would serve one trade unit's tickets to another.
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

    // -------------------------------------------------------------------------

    private static Task<CtrmReadResult<List<CtrmTicketDto>>> Failed(string detail)
        => Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>>
        {
            Status = CtrmReadStatus.Error,
            Detail = detail,
            Value = []
        });

    private TimeSpan LiveTtl() => TimeSpan.FromSeconds(Math.Max(0, ReadInt("Ctrm:LiveCacheSeconds", 60)));

    /// <summary>
    /// How long one window's rows may be reused.
    /// </summary>
    /// <remarks>
    /// A window that still contains today is where new tickets land, so it keeps the short coalescing TTL.
    /// A window that ended in the past holds tickets that can still change - a settlement, a consolidation
    /// - but rarely, so it is kept for <c>Ctrm:HistoricalTicketCacheMinutes</c>. That bounds how stale an
    /// older ticket's status can be on screen, and 30 minutes is the default because it is short enough
    /// that nobody will notice and long enough to absorb a whole session of clicking around.
    /// </remarks>
    private TimeSpan TtlForWindow(DateTime to, DateTime today)
        => to.Date >= today
            ? LiveTtl()
            : TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:HistoricalTicketCacheMinutes", 30)));

    private Task<CtrmReadResult<List<CtrmTicketDto>>> GetCachedAsync(Scope scope)
        => GetCachedAsync(scope.CacheKey, LiveTtl(), () => FetchAsync(scope));

    /// <param name="staleWhileRevalidate">When true, an EXPIRED but successful entry is handed to the
    /// caller immediately while a refresh starts behind it. Used by the trade-unit-wide read, where a
    /// caller must never wait on a multi-page walk that has already been answered once. Off for the
    /// per-producer reads: those are 1-2s and the user has just asked for that producer.</param>
    private Task<CtrmReadResult<List<CtrmTicketDto>>> GetCachedAsync(
        string cacheKey, TimeSpan ttl, Func<Task<CtrmReadResult<List<CtrmTicketDto>>>> fetch,
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

                if (!failed && now < existing.ExpiresUtc)
                    return existing.BestAvailable;

                if (!failed && existing.IsCompleted && staleWhileRevalidate)
                {
                    // Expired but good. Start the refresh, hand this caller the old copy, and carry that copy
                    // on the new entry so callers arriving mid-refresh are served instead of blocking.
                    var fresh = CacheEntry.Deferred(now + ttl, fetch, previous: existing.Read);
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
            var added = CacheEntry.Deferred(now + ttl, fetch);
            var actual = _cache.GetOrAdd(cacheKey, added);
            if (ReferenceEquals(actual, added))
            {
                if (Interlocked.Increment(ref _inserts) % SweepEvery == 0) SweepExpired(now);
                return actual.Read;
            }

            if (now < actual.ExpiresUtc || !actual.Failed)
                return actual.BestAvailable;

            // The entry we found is a failed one past its usefulness; drop it and try again.
            _cache.TryRemove(cacheKey, out _);
        }
    }

    /// <summary>Removes entries past their expiry. Cheap, occasional, and the only thing keeping the
    /// dictionary from growing for the life of the process.</summary>
    private void SweepExpired(DateTime now)
    {
        // Expiry alone is the wrong eviction rule for a trade-unit window: past its TTL is precisely when
        // stale-while-revalidate serves it while a refresh runs, so dropping it here would send Build-a-List
        // back to waiting on a multi-page walk. Those keys get a grace period; per-producer keys do not need
        // one, because their reads are seconds and nothing serves them stale.
        var grace = TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:TradeUnitCacheMinutes", 5)));

        foreach (var pair in _cache)
        {
            var cutoff = pair.Key.StartsWith("producers:", StringComparison.OrdinalIgnoreCase)
                ? pair.Value.ExpiresUtc + grace
                : pair.Value.ExpiresUtc;
            if (pair.Value.IsCompleted && now >= cutoff)
                _cache.TryRemove(pair.Key, out _);
        }
    }

    /// <summary>
    /// Fetches one window for a chunked producer set, all chunks concurrently.
    /// </summary>
    /// <remarks>
    /// No window slicing here, unlike <see cref="FetchAsync"/>: the caller has already chosen a range
    /// inside the server's cap, because the point of this read is that a narrow window is cheap.
    /// </remarks>
    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchChunkedAsync(
        List<string> codes, DateTime from, DateTime to, int maxPages)
    {
        var chunks = codes.Chunk(CtrmCustomerCodes.MaxPerCall).ToList();
        var concurrency = Math.Clamp(ReadInt("Ctrm:PageConcurrency", 4), 1, 8);
        using var slot = new SemaphoreSlim(concurrency, concurrency);

        var results = await Task.WhenAll(chunks.Select(async chunk =>
        {
            await slot.WaitAsync(CancellationToken.None);
            try
            {
                return await FetchWindowAsync(
                    new Scope(
                        CacheKey: string.Empty,
                        Description: $"{chunk.Length} producer(s)",
                        Document: CtrmQueries.TicketsByCustomers,
                        Filter: new { customerIds = chunk }),
                    from, to, maxPages);
            }
            finally
            {
                slot.Release();
            }
        }));

        // Any chunk failing makes the answer incomplete, and a short list here reads as "no spot loads"
        // rather than as a failure.
        var failure = results.FirstOrDefault(r => !r.Ok);
        if (failure is not null) return failure;

        var all = results.SelectMany(r => r.Value ?? []).ToList();

        // A chunk that hit its page cap is PartialSuccess with rows. That must survive the merge: the ticket
        // pool reports itself complete or truncated on this status, and a silently complete-looking partial
        // pool is exactly the failure mode Build-a-List cannot detect.
        var truncated = results.FirstOrDefault(r => r.Status == CtrmReadStatus.PartialSuccess);

        _logger.LogInformation(
            "CTRM live tickets: {Count} tickets for {Producers} producer(s) over {From:yyyy-MM-dd}..{To:yyyy-MM-dd} " +
            "in {Chunks} chunk(s){Truncated}.",
            all.Count, codes.Count, from, to, chunks.Count, truncated is null ? string.Empty : " - TRUNCATED");

        return new CtrmReadResult<List<CtrmTicketDto>>
        {
            Status = truncated is null ? CtrmReadStatus.Ok : CtrmReadStatus.PartialSuccess,
            Detail = truncated?.Detail,
            Value = all
        };
    }

    /// <summary>
    /// The sliced lookback for one scope, each window served from its own age-scaled cache entry.
    /// </summary>
    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchAsync(Scope scope)
    {
        var lookbackDays = Math.Max(1, ReadInt("Ctrm:TicketLookbackDays", 1095));
        var today = DateTime.Today;
        var windows = Subdivide(BuildWindows(today, lookbackDays), ReadInt("Ctrm:InteractiveWindowSplit", 1));

        // Each window is its own cache entry beneath the scope-level one. A repeat visit after the short
        // outer TTL therefore refetches only the window that can have changed - the one containing today.
        var results = await Task.WhenAll(windows.Select(w => GetCachedAsync(
            $"{scope.CacheKey}|window:{w.From:yyyy-MM-dd}:{w.To:yyyy-MM-dd}",
            TtlForWindow(w.To, today),
            () => FetchWindowAsync(scope, w.From, w.To, MaxPagesPerWindow))));

        // Any window failing makes the whole answer incomplete. Reporting the first failure rather than
        // silently returning a partial list keeps an outage from looking like a producer with no tickets.
        var failure = results.FirstOrDefault(r => !r.Ok);
        if (failure is not null)
            return new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = failure.Status,
                HttpStatus = failure.HttpStatus,
                ErrorCode = failure.ErrorCode,
                Detail = failure.Detail,
                Value = []
            };

        var all = results.SelectMany(r => r.Value ?? []).ToList();

        _logger.LogInformation(
            "CTRM live tickets: {Count} tickets for {Scope} across {Windows} window(s) ({Days}-day lookback).",
            all.Count, scope.Description, windows.Count, lookbackDays);

        return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };
    }

    /// <summary>
    /// Splits a lookback into consecutive windows no wider than the server's cap, newest first.
    /// </summary>
    /// <remarks>
    /// Windows are inclusive on both ends, so each one starts the day after the previous ends - otherwise
    /// a ticket on a boundary date would be fetched twice and appear duplicated on screen.
    /// </remarks>
    public static List<(DateTime From, DateTime To)> BuildWindows(DateTime today, int lookbackDays)
    {
        var max = CtrmQueries.MaxTicketRangeDays;
        var windows = new List<(DateTime, DateTime)>();

        // Reach one day into the future so a ticket dated today is never missed to a clock/timezone skew
        // between us and the Db2 host.
        var to = today.AddDays(1);
        var earliest = today.AddDays(-lookbackDays);

        while (to > earliest)
        {
            var from = to.AddDays(-max);
            if (from < earliest) from = earliest;
            windows.Add((from, to));
            to = from.AddDays(-1);
        }

        return windows;
    }

    /// <summary>
    /// Splits each window into <paramref name="parts"/> contiguous sub-windows, fetched in parallel.
    /// </summary>
    /// <remarks>
    /// <para><b>Ships off (parts = 1) because the evidence conflicts.</b> A ticket read is charged by the
    /// date scan, so narrower ranges are individually cheaper - one probe run saw a window go 3.4s to 2.3s
    /// at 2-3 sub-windows, and worse at 6. But an independent run saw four parallel quarters do WORSE than
    /// a single call (10.7s against 7.3s), because concurrent scans contend on the server. Splitting also
    /// multiplies requests per click, which fights the interactive page cap. Both measurements are real;
    /// which one applies depends on load, so this stays a dial at 1 until an A/B on
    /// /api/diagnostics/ctrm/producer-timing shows a win under realistic conditions.</para>
    ///
    /// <para>Sub-windows follow the same rule as <see cref="BuildWindows"/>: inclusive on both ends, each
    /// starting the day after the previous ends, so a ticket on a boundary date is fetched exactly once.
    /// They keep the same cache-key shape, so the age-scaled TTL still applies per sub-window.</para>
    /// </remarks>
    public static List<(DateTime From, DateTime To)> Subdivide(List<(DateTime From, DateTime To)> windows, int parts)
    {
        parts = Math.Clamp(parts, 1, 3);
        if (parts == 1) return windows;

        var split = new List<(DateTime, DateTime)>(windows.Count * parts);

        foreach (var (from, to) in windows)
        {
            // Inclusive on both ends, so a one-day window spans 1 day, not 0.
            var totalDays = (int)(to - from).TotalDays + 1;
            if (totalDays < parts * 2) { split.Add((from, to)); continue; }

            var size = totalDays / parts;
            var cursor = from;

            for (var i = 0; i < parts; i++)
            {
                // The last part absorbs the remainder, so the union is exactly the original window.
                var end = i == parts - 1 ? to : cursor.AddDays(size - 1);
                split.Add((cursor, end));
                cursor = end.AddDays(1);
            }
        }

        return split;
    }

    /// <summary>
    /// One window's tickets: first page, then the remaining pages concurrently.
    /// </summary>
    /// <remarks>
    /// <para><b>Why not a simple sequential loop.</b> It was one, and it cost real time on exactly the
    /// producers who matter most. Measured 2026-08-27 against an idle gateway: TATOBIN has 821 tickets and
    /// its per-producer read took 13.3s, because each 500-row page waited for the one before it. The first
    /// page reports <c>totalCount</c>, so the rest can go at once - the same two-phase pump
    /// <see cref="CtrmContractReader"/> already used for contracts.</para>
    ///
    /// <para><b><c>hasNextPage</c> stays authoritative.</b> <c>totalCount</c> only decides how many pages to
    /// REQUEST up front. If the last page fetched still reports more, the pump continues sequentially rather
    /// than trusting the arithmetic - the two can disagree, and silently dropping a producer's tickets is the
    /// one outcome worth an extra round trip to avoid. Equally, the loop never keeps going on a count alone,
    /// which would spend requests on empty pages when <c>totalCount</c> counts something broader.</para>
    /// </remarks>
    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchWindowAsync(Scope scope, DateTime from, DateTime to, int maxPages)
    {
        var window = $"{from:yyyy-MM-dd}..{to:yyyy-MM-dd}";

        var first = await FetchTicketPageAsync(scope, from, to, 0);
        if (!first.Ok) return PropagatePageFailure(first, scope, window);

        var firstPage = first.Value?.Tickets;
        if (firstPage is null)
            return new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = CtrmReadStatus.Error,
                HttpStatus = first.HttpStatus,
                Detail = $"CTRM returned no tickets object for {scope.Description}.",
                Value = []
            };

        var all = new List<CtrmTicketDto>(firstPage.Items);
        var hasMore = firstPage.PageInfo?.HasNextPage == true;
        if (!hasMore)
            return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };

        // How many pages the reported count implies, bounded by the cap. At least two, because the server
        // just said there is more.
        var pagesAvailable = (int)Math.Ceiling(firstPage.TotalCount / (double)PageSize);
        var pagesToFetch = Math.Min(Math.Max(pagesAvailable, 2), maxPages);
        var nextPage = 1;

        if (pagesToFetch > 1)
        {
            // Interactive reads are bounded. Unbounded, a nine-page window across three windows is
            // twenty-seven simultaneous requests for one click, and the gateway was measured degrading at
            // nine-way fan-out - so the pages would slow each other down. Background pages are already
            // bounded by CtrmTradeUnitThrottle, so they pass through.
            using var slot = scope.CacheKey.Length > 0
                ? new SemaphoreSlim(Math.Clamp(ReadInt("Ctrm:InteractivePageConcurrency", 4), 1, 16))
                : null;

            async Task<CtrmReadResult<CtrmTicketsResponse>> BoundedPage(int page)
            {
                if (slot is null) return await FetchTicketPageAsync(scope, from, to, page * PageSize);

                await slot.WaitAsync(CancellationToken.None);
                try { return await FetchTicketPageAsync(scope, from, to, page * PageSize); }
                finally { slot.Release(); }
            }

            var rest = await Task.WhenAll(Enumerable.Range(1, pagesToFetch - 1).Select(BoundedPage));

            var failed = rest.FirstOrDefault(r => !r.Ok);
            if (failed is not null) return PropagatePageFailure(failed, scope, window);

            foreach (var page in rest)
            {
                var data = page.Value?.Tickets;
                if (data is not null) all.AddRange(data.Items);
            }

            // Ordered by construction, so the last element is the highest skip - its verdict is the current one.
            hasMore = rest[^1].Value?.Tickets?.PageInfo?.HasNextPage == true;
            nextPage = pagesToFetch;
        }

        // Only entered when the count under-reported: keep going while the SERVER says there is more.
        while (hasMore && nextPage < maxPages)
        {
            var extra = await FetchTicketPageAsync(scope, from, to, nextPage * PageSize);
            if (!extra.Ok) return PropagatePageFailure(extra, scope, window);

            var data = extra.Value?.Tickets;
            if (data is null) break;

            all.AddRange(data.Items);
            hasMore = data.PageInfo?.HasNextPage == true;
            nextPage++;
        }

        if (hasMore)
        {
            _logger.LogError(
                "CTRM live tickets TRUNCATED [{ErrorCode}] [{ErrorCategory}]: {Scope} window {Window} " +
                "still had more after {MaxPages} pages ({Count} rows).",
                "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", scope.Description, window, maxPages, all.Count);

            return new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = CtrmReadStatus.PartialSuccess,
                Detail = $"Truncated after {maxPages} pages in {window}.",
                Value = all
            };
        }

        return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };
    }

    /// <summary>
    /// One ticket page, routed by whether a user is waiting on it or a background walk is.
    /// </summary>
    /// <remarks>
    /// A batched page (empty cache key - the trade-unit walk and Spot Loads) takes a bounded background slot
    /// and yields to interactive work. A per-producer or contract-scoped page is what a user is watching a
    /// spinner for, so it never queues, and it announces itself so the walk stands aside while it runs. The
    /// server-timeout retry wraps both: CTRM finishes and caches the query after answering HC0045, so an
    /// identical re-send a few seconds later succeeds.
    /// </remarks>
    private async Task<CtrmReadResult<CtrmTicketsResponse>> FetchTicketPageAsync(Scope scope, DateTime from, DateTime to, int skip)
    {
        // Deliberately not the caller's token: concurrent callers share this read, so one navigating away
        // must not cancel the work the others are awaiting.
        Task<CtrmReadResult<CtrmTicketsResponse>> Page() => CtrmServerTimeoutRetry.RunAsync(
            () => _client.QueryAsync<CtrmTicketsResponse>(
                scope.Document,
                BuildVariables(scope.Filter, from, to, skip),
                CancellationToken.None),
            _configuration, _logger, $"tickets page skip={skip} for {scope.Description} {from:yyyy-MM-dd}..{to:yyyy-MM-dd}",
            interactive: scope.CacheKey.Length > 0);

        if (scope.CacheKey.Length == 0)
            return await CtrmTradeUnitThrottle.RunAsync(_configuration, Page);

        using var interactive = CtrmTradeUnitThrottle.Interactive();
        return await Page();
    }

    private CtrmReadResult<List<CtrmTicketDto>> PropagatePageFailure(
        CtrmReadResult<CtrmTicketsResponse> failure, Scope scope, string window) => new()
        {
            Status = failure.Status,
            HttpStatus = failure.HttpStatus,
            ErrorCode = failure.ErrorCode,
            Detail = $"Live ticket read failed for {scope.Description} ({window}): {failure.Detail}",
            Value = []
        };

    /// <summary>
    /// Combines a scope's filter argument with the window and paging arguments every ticket query takes.
    /// </summary>
    /// <remarks>
    /// A dictionary rather than an anonymous type because the filter half differs per document
    /// (<c>customerId</c> vs <c>contractNumbers</c>), and the client serializes either shape identically.
    /// </remarks>
    private static Dictionary<string, object?> BuildVariables(object filter, DateTime from, DateTime to, int skip)
    {
        var variables = new Dictionary<string, object?>
        {
            ["from"] = from.ToString("yyyy-MM-dd"),
            ["to"] = to.ToString("yyyy-MM-dd"),
            ["skip"] = skip,
            ["take"] = PageSize
        };

        foreach (var property in filter.GetType().GetProperties())
            variables[property.Name] = property.GetValue(filter);

        return variables;
    }

    /// <summary>
    /// Reads an int setting, falling back when absent or unparseable.
    /// </summary>
    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
}
