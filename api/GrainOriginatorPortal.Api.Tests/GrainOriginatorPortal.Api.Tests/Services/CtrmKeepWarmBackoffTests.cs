// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The keep-warm back-off: a producer set whose read failed is left alone until its back-off expires,
/// so a slow gateway is not re-walked every five minutes by a cycle that cannot succeed. Added
/// 2026-09-28 after the nonprod gateway's slow phase. The cycle itself is still not unit-testable (see
/// <see cref="CtrmKeepWarmServiceTests"/>), so the decision it makes is pinned here on its own.
/// </summary>
public class CtrmKeepWarmBackoffTests
{
    private static readonly DateTime Now = new(2026, 9, 28, 19, 0, 0, DateTimeKind.Utc);
    private static readonly IReadOnlyList<string> Pratt = ["1000FRM", "2BFAKI", "3SG"];
    private static readonly IReadOnlyList<string> Tribune = ["ABC", "DEF"];

    [Fact]
    public void ASetIsNotBackedOffUntilAFailureIsRecorded()
    {
        var sut = new CtrmKeepWarmBackoff();

        Assert.False(sut.IsBackedOff(Pratt, Now));
    }

    [Fact]
    public void AfterAFailure_TheSetIsBackedOffUntilTheDurationExpires()
    {
        var sut = new CtrmKeepWarmBackoff();
        sut.Record(Pratt, Now, TimeSpan.FromMinutes(15));

        Assert.True(sut.IsBackedOff(Pratt, Now));
        Assert.True(sut.IsBackedOff(Pratt, Now.AddMinutes(14).AddSeconds(59)));
        Assert.False(sut.IsBackedOff(Pratt, Now.AddMinutes(15)));   // expiry is inclusive: the next cycle tries again
        Assert.False(sut.IsBackedOff(Pratt, Now.AddMinutes(16)));   // and the expired entry stays forgotten
    }

    [Fact]
    public void OneSetsFailure_DoesNotBackOffAnotherSet()
    {
        var sut = new CtrmKeepWarmBackoff();
        sut.Record(Pratt, Now, TimeSpan.FromMinutes(15));

        Assert.True(sut.IsBackedOff(Pratt, Now));
        Assert.False(sut.IsBackedOff(Tribune, Now));
    }

    [Fact]
    public void ASuccessfulCycle_ClearsTheBackOff()
    {
        var sut = new CtrmKeepWarmBackoff();
        sut.Record(Pratt, Now, TimeSpan.FromMinutes(15));

        sut.Clear(Pratt);

        Assert.False(sut.IsBackedOff(Pratt, Now));
    }

    [Fact]
    public void TheKeyIgnoresCodeOrderAndPadding()
    {
        // The registry hands the cycle the same set each time, but a key that depended on order or on
        // trailing spaces would let one set be backed off under one spelling and re-walked under another.
        Assert.Equal(
            CtrmKeepWarmBackoff.KeyFor(["3SG", " 1000FRM", "2BFAKI "]),
            CtrmKeepWarmBackoff.KeyFor(Pratt));
        Assert.NotEqual(CtrmKeepWarmBackoff.KeyFor(Pratt), CtrmKeepWarmBackoff.KeyFor(Tribune));
    }
}
