// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The keep-warm service's cadence/source gate. Every gate here fails silently: a wrong answer
/// either issues CTRM traffic from an environment that is meant to be reading ODS, or quietly stops
/// warming so the cost of a cold refresh lands back on whichever user prompts first. Neither throws,
/// and the one-minute loop meant these branches were only ever exercised against a live CTRM server.
/// </summary>
/// <remarks>
/// <para>Scope. <c>ShouldWarmNow</c> is the whole of the gate and is covered exhaustively below. The
/// per-producer-set failure isolation in the cycle itself is covered by <c>CtrmKeepWarmCycleTests</c>,
/// which became possible on 2026-10-13 when the three CTRM reads went behind <c>ICtrmWarmReads</c> and
/// <c>WarmActiveSetsAsync</c> was made internal.</para>
///
/// <para>The keep-for window the cycle applies to the registry is already covered by
/// <c>CtrmServeFromWarmCacheTests.TheWarmRegistryTracksRecentSetsAndForgetsOldOnes</c>, so it is not
/// repeated here.</para>
/// </remarks>
public class CtrmKeepWarmServiceTests
{
    /// <summary>A fixed clock, so every case reads as an offset from one moment.</summary>
    private static readonly DateTime Now = new(2026, 9, 21, 13, 0, 0, DateTimeKind.Utc);

    // -------------------------------------------------------------------------
    // The cadence gate — Ctrm:KeepWarmMinutes at or below zero disables warming.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-60)]
    public void ACadenceAtOrBelowZero_DisablesWarmingOutright(int cadenceMinutes)
    {
        // The documented off switch: an App Service override of 0 must stop the cycle without a
        // restart, and must win even when every other gate would pass.
        Assert.False(CtrmKeepWarmService.ShouldWarmNow(cadenceMinutes, "ctrm", Now, DateTime.MinValue));
    }

    [Fact]
    public void APositiveCadence_WithEverythingElseSatisfied_Warms()
    {
        Assert.True(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now.AddMinutes(-5)));
    }

    // -------------------------------------------------------------------------
    // The elapsed gate — a tick inside the cadence is skipped.
    // -------------------------------------------------------------------------

    [Fact]
    public void ExactlyAtTheCadence_IsTrue()
    {
        // Boundary: >= not >. With > and a one-minute loop, a five-minute cadence would drift a
        // minute later on every cycle instead of holding to the clock.
        Assert.True(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now.AddMinutes(-5)));
    }

    [Fact]
    public void OneSecondShortOfTheCadence_IsFalse()
    {
        Assert.False(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now.AddMinutes(-5).AddSeconds(1)));
    }

    [Fact]
    public void ATickImmediatelyAfterACycle_IsFalse()
    {
        // The common case: the minute timer fires four times between five-minute cycles.
        Assert.False(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now));
    }

    [Fact]
    public void WellPastTheCadence_IsTrue()
    {
        Assert.True(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now.AddHours(-3)));
    }

    [Fact]
    public void TheFirstRunOfTheProcess_IsTrue()
    {
        // lastRunUtc starts at DateTime.MinValue, so the first tick after startup must warm rather
        // than wait out a cadence the process has no history for.
        Assert.True(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, DateTime.MinValue));
    }

    [Fact]
    public void AClockThatWentBackwards_IsFalse()
    {
        // Negative elapsed time never satisfies the cadence; the next forward tick picks it up.
        Assert.False(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now.AddMinutes(10)));
    }

    // -------------------------------------------------------------------------
    // The source gate — warming runs only while Ctrm:Source is ctrm.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("ctrm")]
    [InlineData("CTRM")]
    [InlineData("Ctrm")]
    [InlineData(" ctrm")]
    [InlineData("ctrm ")]
    [InlineData("  CtRm  ")]
    [InlineData("\tctrm\r\n")]
    public void TheSourceMatchIsTrimmedAndCaseInsensitive(string configuredSource)
    {
        // Asserting the comparison the code actually makes - Trim() plus OrdinalIgnoreCase - so a
        // hand-typed App Service value with stray whitespace or capitals still warms.
        Assert.True(CtrmKeepWarmService.ShouldWarmNow(5, configuredSource, Now, DateTime.MinValue));
    }

    [Theory]
    [InlineData(null)]          // key absent from configuration entirely
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ods")]         // the other real value - an ODS environment must issue no CTRM traffic
    [InlineData("ODS")]
    [InlineData("ctrmx")]       // near miss: this is an equality check, not a prefix match
    [InlineData("xctrm")]
    [InlineData("ct rm")]       // trimming is at the ends only, never internal
    [InlineData("ctrm,ods")]
    public void AnySourceOtherThanCtrm_SkipsTheCycle(string? configuredSource)
    {
        Assert.False(CtrmKeepWarmService.ShouldWarmNow(5, configuredSource, Now, DateTime.MinValue));
    }

    // -------------------------------------------------------------------------
    // All three gates together.
    // -------------------------------------------------------------------------

    [Fact]
    public void EachGateBlocksOnItsOwn()
    {
        // The baseline every variant below mutates exactly one input away from.
        Assert.True(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now.AddMinutes(-5)));

        Assert.False(CtrmKeepWarmService.ShouldWarmNow(0, "ctrm", Now, Now.AddMinutes(-5)));
        Assert.False(CtrmKeepWarmService.ShouldWarmNow(5, "ods", Now, Now.AddMinutes(-5)));
        Assert.False(CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", Now, Now.AddMinutes(-1)));
    }

    [Fact]
    public void OverTwelveMinuteTicks_AFiveMinuteCadenceWarmsEveryFifthTick()
    {
        // End to end through the gate the way ExecuteAsync drives it: a fixed one-minute tick, with
        // lastRunUtc advanced only when a cycle runs. The cadence must hold to five minutes rather
        // than slipping a minute per cycle.
        var start = Now;
        var lastRunUtc = start;              // as if a cycle had just run
        var warmedAt = new List<int>();

        for (var minute = 1; minute <= 12; minute++)
        {
            var tick = start.AddMinutes(minute);
            if (!CtrmKeepWarmService.ShouldWarmNow(5, "ctrm", tick, lastRunUtc)) continue;

            lastRunUtc = tick;
            warmedAt.Add(minute);
        }

        Assert.Equal([5, 10], warmedAt);
    }

    [Fact]
    public void OverTheSameTicks_AnOdsEnvironmentNeverWarms()
    {
        var start = Now;

        for (var minute = 1; minute <= 12; minute++)
            Assert.False(CtrmKeepWarmService.ShouldWarmNow(5, "ods", start.AddMinutes(minute), DateTime.MinValue),
                $"tick at +{minute}m warmed while Ctrm:Source was ods");
    }
}
