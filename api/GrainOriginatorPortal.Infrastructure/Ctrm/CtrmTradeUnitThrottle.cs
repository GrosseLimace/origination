using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Keeps the background trade-unit walks out of the way of the reads a user is waiting on.
/// </summary>
/// <remarks>
/// <para><b>The problem this solves.</b> A trade-unit read is hundreds of requests (587 per-producer
/// contract calls, plus a ticket walk over three windows). A producer-screen read is six or seven. They
/// share one gateway, and measured on 2026-08-27 the gateway saturates: with a walk running, a single
/// producer's ticket window went from its usual 1-3s to 5-12s, and clicks felt broken. Client-side
/// concurrency does not fix it - 8, 16, 24 and 32 concurrent all landed within noise of each other, then
/// degraded.</para>
///
/// <para><b>Two mechanisms, not one.</b> A fixed cap alone forces a bad choice: low enough to protect
/// clicks means the walk crawls even when nobody is clicking. So there is also a PRIORITY rule -
/// background work waits while any interactive read is in flight. The walk therefore runs at its full cap
/// on an idle app and stands aside the moment someone selects a producer.</para>
///
/// <para><b>Why the deferral is bounded.</b> If interactive reads never stopped arriving, unbounded
/// deference would starve the walk and Build-a-List would never populate. After
/// <c>Ctrm:BackgroundMaxDeferSeconds</c> a background call proceeds regardless, so the walk always makes
/// forward progress - it just makes it slowly while the app is busy.</para>
///
/// <para>Static because the two readers are separate singletons and both the cap and the priority signal
/// have to be shared between them.</para>
/// </remarks>
public static class CtrmTradeUnitThrottle
{
    private static SemaphoreSlim? _slots;
    /// <summary>The contract-batch pool - see <see cref="RunContractBatchAsync{T}"/> for why it is separate.</summary>
    private static SemaphoreSlim? _batchSlots;
    private static readonly object Init = new();

    /// <summary>How many interactive (user-facing) CTRM reads are in flight right now.</summary>
    private static int _interactive;

    /// <summary>How long a deferring background call sleeps between checks.</summary>
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(200);

    /// <summary>
    /// Marks a user-facing read as in flight. Background work defers while any of these are open.
    /// </summary>
    /// <remarks>
    /// Wrap the actual HTTP fetch, not a cache lookup: a cache hit costs the gateway nothing and should
    /// not hold the walk back. Dispose is idempotent, so a <c>using</c> in a retry loop is safe.
    /// </remarks>
    public static IDisposable Interactive() => new InteractiveScope();

    /// <summary>True when a user-facing read is in flight. For diagnostics and tests.</summary>
    public static bool InteractiveInFlight => Volatile.Read(ref _interactive) > 0;

    /// <summary>
    /// Runs background trade-unit work: defers to interactive reads, then takes one of the bounded slots.
    /// </summary>
    public static async Task<T> RunAsync<T>(IConfiguration configuration, Func<Task<T>> work)
    {
        await DeferToInteractiveAsync(configuration);

        var slots = Slots(configuration);
        await slots.WaitAsync(CancellationToken.None);
        try
        {
            return await work();
        }
        finally
        {
            slots.Release();
        }
    }

    /// <summary>
    /// Runs one BATCHED contract request (several producers as GraphQL aliases): defers to interactive
    /// reads exactly like <see cref="RunAsync{T}"/>, then takes a slot from a pool of its own, sized by
    /// <c>Ctrm:TradeUnitContractBatchConcurrency</c>.
    /// </summary>
    /// <remarks>
    /// <para><b>Why a second pool rather than a bigger shared one.</b> Measured 2026-09-24 on the 587-producer
    /// unit: batched requests (10 producers each) at 6 in flight took 38-44 s; at 16 in flight, 4.7-8.3 s
    /// with the identical contract set and no 429s - batching had cut the walk to ~59 requests, so the
    /// request-rate quota that capped the one-per-call walk at ~6 no longer binds. But the shared pool also
    /// gates the ticket pages, and 8 ticket chunks in flight produced HC0045 server timeouts the same day.
    /// Raising the shared cap would trade a faster contract walk for a broken ticket walk. So contract
    /// batches get their own cap and ticket pages keep theirs.</para>
    ///
    /// <para>This also removes the starvation seen live at 15:03: a user selected a second trade unit while
    /// the first unit's ticket history (~160 pages) was draining through the shared pool, and the contract
    /// walk they were waiting on took 150 s instead of ~48 s because only a fraction of the six slots ever
    /// came its way. With separate pools the ticket pages of a unit nobody is looking at can no longer hold
    /// the contract walk of the one they are.</para>
    /// </remarks>
    public static async Task<T> RunContractBatchAsync<T>(IConfiguration configuration, Func<Task<T>> work)
    {
        await DeferToInteractiveAsync(configuration);

        var slots = BatchSlots(configuration);
        await slots.WaitAsync(CancellationToken.None);
        try
        {
            return await work();
        }
        finally
        {
            slots.Release();
        }
    }

    /// <summary>Resets the shared state. Tests only - the caps are otherwise read once per process.</summary>
    public static void ResetForTests()
    {
        lock (Init)
        {
            _slots = null;
            _batchSlots = null;
            Volatile.Write(ref _interactive, 0);
        }
    }

    private static async Task DeferToInteractiveAsync(IConfiguration configuration)
    {
        var maxDefer = TimeSpan.FromSeconds(Math.Clamp(CtrmConfig.ReadInt(configuration, "Ctrm:BackgroundMaxDeferSeconds", 20), 0, 300));
        if (maxDefer <= TimeSpan.Zero) return;

        var waited = TimeSpan.Zero;
        while (InteractiveInFlight && waited < maxDefer)
        {
            await Task.Delay(PollInterval);
            waited += PollInterval;
        }
    }

    private static SemaphoreSlim Slots(IConfiguration configuration)
    {
        if (_slots is not null) return _slots;
        lock (Init)
        {
            if (_slots is not null) return _slots;
            var capacity = Math.Clamp(CtrmConfig.ReadInt(configuration, "Ctrm:TradeUnitMaxConcurrentRequests", 6), 1, 16);
            _slots = new SemaphoreSlim(capacity, capacity);
            return _slots;
        }
    }

    private static SemaphoreSlim BatchSlots(IConfiguration configuration)
    {
        if (_batchSlots is not null) return _batchSlots;
        lock (Init)
        {
            if (_batchSlots is not null) return _batchSlots;
            var capacity = Math.Clamp(CtrmConfig.ReadInt(configuration, "Ctrm:TradeUnitContractBatchConcurrency", 8), 1, 32);
            _batchSlots = new SemaphoreSlim(capacity, capacity);
            return _batchSlots;
        }
    }

    private sealed class InteractiveScope : IDisposable
    {
        private bool _released;

        public InteractiveScope() => Interlocked.Increment(ref _interactive);

        public void Dispose()
        {
            if (_released) return;
            _released = true;
            // Never below zero. The counter is process-wide, and ResetForTests writes 0 to it while other
            // test classes may still hold a scope; that scope's Dispose then drove it to -1, after which a
            // genuinely open scope read as "nothing in flight" and the background walk stopped yielding.
            // Seen 2026-09-30 as an order-dependent failure in the ticket reader tests once the suite grew.
            // In production nothing resets the counter, so this is a guard, not a behaviour change.
            int current;
            do
            {
                current = Volatile.Read(ref _interactive);
                if (current <= 0) return;
            }
            while (Interlocked.CompareExchange(ref _interactive, current - 1, current) != current);
        }
    }
}
