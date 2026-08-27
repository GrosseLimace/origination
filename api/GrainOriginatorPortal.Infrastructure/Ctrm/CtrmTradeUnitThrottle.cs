using System.Globalization;
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

    /// <summary>Resets the shared state. Tests only - the cap is otherwise read once per process.</summary>
    public static void ResetForTests()
    {
        lock (Init)
        {
            _slots = null;
            Volatile.Write(ref _interactive, 0);
        }
    }

    private static async Task DeferToInteractiveAsync(IConfiguration configuration)
    {
        var maxDefer = TimeSpan.FromSeconds(Math.Clamp(ReadInt(configuration, "Ctrm:BackgroundMaxDeferSeconds", 20), 0, 300));
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
            var capacity = Math.Clamp(ReadInt(configuration, "Ctrm:TradeUnitMaxConcurrentRequests", 6), 1, 16);
            _slots = new SemaphoreSlim(capacity, capacity);
            return _slots;
        }
    }

    private static int ReadInt(IConfiguration configuration, string key, int fallback) =>
        int.TryParse(configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : fallback;

    private sealed class InteractiveScope : IDisposable
    {
        private bool _released;

        public InteractiveScope() => Interlocked.Increment(ref _interactive);

        public void Dispose()
        {
            if (_released) return;
            _released = true;
            Interlocked.Decrement(ref _interactive);
        }
    }
}
