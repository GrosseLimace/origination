// Microsoft namespaces
using Microsoft.Extensions.Configuration;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The throttle is what keeps a 587-request trade-unit walk from making the producer screen feel broken,
/// so its two rules - a bounded cap, and background yielding to interactive - are pinned here.
/// </summary>
/// <remarks>
/// These share process-wide static state, so the collection runs them one at a time and each resets first.
/// </remarks>
[Collection("CtrmThrottle")]
public class CtrmTradeUnitThrottleTests
{
    private static IConfiguration Config(int cap = 2, int deferSeconds = 20, int batchCap = 16) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TradeUnitMaxConcurrentRequests"] = cap.ToString(),
            ["Ctrm:TradeUnitContractBatchConcurrency"] = batchCap.ToString(),
            ["Ctrm:BackgroundMaxDeferSeconds"] = deferSeconds.ToString()
        }).Build();

    public CtrmTradeUnitThrottleTests() => CtrmTradeUnitThrottle.ResetForTests();

    // -------------------------------------------------------------------------
    [Fact]
    public void AScopeDisposedAfterAReset_CannotLeaveTheCounterNegative()
    {
        // The counter is process-wide. ResetForTests zeroes it while another test class may still hold a
        // scope; before the guard, that scope's Dispose took it to -1 and a later, genuinely open scope
        // read as "nothing in flight" - the order-dependent failure seen in CtrmTicketReaderTests on
        // 2026-09-30. Disposing past zero must be a no-op, so the next scope is visible again.
        var stale = CtrmTradeUnitThrottle.Interactive();
        CtrmTradeUnitThrottle.ResetForTests();
        stale.Dispose();

        Assert.False(CtrmTradeUnitThrottle.InteractiveInFlight);
        using (CtrmTradeUnitThrottle.Interactive())
        {
            Assert.True(CtrmTradeUnitThrottle.InteractiveInFlight);
        }
        Assert.False(CtrmTradeUnitThrottle.InteractiveInFlight);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ContractBatchesHaveTheirOwnCap_AndDoNotQueueBehindTheSharedPool()
    {
        // Why this matters: live on 2026-09-24 a contract walk took 150 s instead of ~48 s because it shared
        // six slots with another trade unit's ~160 ticket pages. Batches must not wait on that pool, and the
        // shared cap must not widen just because batches want more in flight (8 ticket pages in flight
        // produced server timeouts the same day).
        var config = Config(cap: 2, batchCap: 4);
        var sharedRelease = new TaskCompletionSource();
        var sharedRunning = 0;

        // Saturate the SHARED pool and hold it.
        var shared = Enumerable.Range(0, 2).Select(_ => CtrmTradeUnitThrottle.RunAsync(config, async () =>
        {
            Interlocked.Increment(ref sharedRunning);
            await sharedRelease.Task;
            return 0;
        })).ToList();
        while (Volatile.Read(ref sharedRunning) < 2) await Task.Delay(10);

        // Batches still run - four of them at once, their own cap - while the shared pool is full.
        var batchRunning = 0;
        var batchPeak = 0;
        var batchRelease = new TaskCompletionSource();
        var batches = Enumerable.Range(0, 6).Select(_ => CtrmTradeUnitThrottle.RunContractBatchAsync(config, async () =>
        {
            var now = Interlocked.Increment(ref batchRunning);
            lock (config) { if (now > batchPeak) batchPeak = now; }
            await batchRelease.Task;
            Interlocked.Decrement(ref batchRunning);
            return 0;
        })).ToList();

        while (Volatile.Read(ref batchRunning) < 4) await Task.Delay(10);
        await Task.Delay(100);
        Assert.Equal(4, batchPeak);                                  // capped by ITS cap, not the shared 2
        Assert.Equal(2, Volatile.Read(ref sharedRunning));           // and the shared pool was untouched

        batchRelease.SetResult();
        sharedRelease.SetResult();
        await Task.WhenAll(batches.Concat(shared));
        Assert.Equal(4, batchPeak);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ContractBatchesStillYieldToAnInteractiveRead()
    {
        // The separate pool must not lose the priority rule: a click still comes first.
        var config = Config(batchCap: 8);
        var started = false;

        using (CtrmTradeUnitThrottle.Interactive())
        {
            var batch = CtrmTradeUnitThrottle.RunContractBatchAsync(config, () =>
            {
                started = true;
                return Task.FromResult(0);
            });

            await Task.Delay(500);
            Assert.False(started, "a contract batch ran while an interactive read was in flight");

            CtrmTradeUnitThrottle.ResetForTests();
            await batch;
        }

        Assert.True(started);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BackgroundWorkIsCappedAtTheConfiguredConcurrency()
    {
        var config = Config(cap: 2);
        var running = 0;
        var peak = 0;
        var release = new TaskCompletionSource();

        var work = Enumerable.Range(0, 6).Select(_ => CtrmTradeUnitThrottle.RunAsync(config, async () =>
        {
            var now = Interlocked.Increment(ref running);
            lock (config) { if (now > peak) peak = now; }
            await release.Task;
            Interlocked.Decrement(ref running);
            return 0;
        })).ToList();

        // Let the first wave take its slots, then prove no more than the cap got in.
        while (Volatile.Read(ref running) < 2) await Task.Delay(10);
        await Task.Delay(100);
        Assert.Equal(2, peak);

        release.SetResult();
        await Task.WhenAll(work);
        Assert.Equal(2, peak);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BackgroundWorkWaitsWhileAnInteractiveReadIsInFlight()
    {
        // The whole point: a click must not queue behind a walk. With an interactive read open, background
        // work should not start at all.
        var config = Config(cap: 4);
        var started = false;

        using (CtrmTradeUnitThrottle.Interactive())
        {
            var background = CtrmTradeUnitThrottle.RunAsync(config, () =>
            {
                started = true;
                return Task.FromResult(0);
            });

            await Task.Delay(500);
            Assert.False(started, "background work ran while an interactive read was in flight");
            Assert.True(CtrmTradeUnitThrottle.InteractiveInFlight);

            // Releasing the interactive scope lets it through.
            CtrmTradeUnitThrottle.ResetForTests();
            await background;
        }

        Assert.True(started);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheDeferralIsBoundedSoABusyAppCannotStarveTheWalk()
    {
        // Without a bound, a stream of clicks would mean Build-a-List never populates.
        var config = Config(cap: 4, deferSeconds: 1);

        using var neverEnds = CtrmTradeUnitThrottle.Interactive();

        var start = DateTime.UtcNow;
        var result = await CtrmTradeUnitThrottle.RunAsync(config, () => Task.FromResult(42));
        var waited = DateTime.UtcNow - start;

        Assert.Equal(42, result);
        Assert.True(waited >= TimeSpan.FromSeconds(0.8), $"went ahead after only {waited.TotalSeconds:F1}s - it should have deferred first");
        Assert.True(waited < TimeSpan.FromSeconds(5), $"deferred for {waited.TotalSeconds:F1}s - the bound did not apply");
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task InteractiveScopesNest()
    {
        // Several per-producer reads overlap constantly (contracts, applied tickets, unapplied tickets), so
        // one finishing must not clear the signal for the others.
        using var first = CtrmTradeUnitThrottle.Interactive();
        var second = CtrmTradeUnitThrottle.Interactive();

        second.Dispose();
        Assert.True(CtrmTradeUnitThrottle.InteractiveInFlight);

        second.Dispose();   // idempotent - must not double-decrement
        Assert.True(CtrmTradeUnitThrottle.InteractiveInFlight);

        await Task.CompletedTask;
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task WithNothingInteractiveBackgroundWorkRunsImmediately()
    {
        var config = Config(cap: 4);

        var start = DateTime.UtcNow;
        await CtrmTradeUnitThrottle.RunAsync(config, () => Task.FromResult(0));

        Assert.True(DateTime.UtcNow - start < TimeSpan.FromSeconds(1), "an idle app should not delay the walk");
    }
}

/// <summary>Serialises the throttle tests - they mutate process-wide static state.</summary>
[CollectionDefinition("CtrmThrottle", DisableParallelization = true)]
public class CtrmThrottleCollection { }
