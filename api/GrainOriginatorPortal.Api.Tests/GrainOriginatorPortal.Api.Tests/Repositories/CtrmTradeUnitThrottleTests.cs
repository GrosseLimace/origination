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
    private static IConfiguration Config(int cap = 2, int deferSeconds = 20) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TradeUnitMaxConcurrentRequests"] = cap.ToString(),
            ["Ctrm:BackgroundMaxDeferSeconds"] = deferSeconds.ToString()
        }).Build();

    public CtrmTradeUnitThrottleTests() => CtrmTradeUnitThrottle.ResetForTests();

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
