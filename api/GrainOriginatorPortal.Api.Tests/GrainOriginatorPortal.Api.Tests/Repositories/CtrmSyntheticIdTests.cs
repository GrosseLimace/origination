// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the surrogate ids manufactured for CTRM records. The Angular client dedupes contracts on
/// this value alone, so the properties tested here are what stop two contracts collapsing into one
/// row on screen.
/// </summary>
public class CtrmSyntheticIdTests
{
    /// <summary>Number.MAX_SAFE_INTEGER — the largest integer a JavaScript number holds exactly.</summary>
    private const long MaxSafeInteger = 9_007_199_254_740_991;

    // -------------------------------------------------------------------------
    [Fact]
    public void IsStableAcrossCalls()
    {
        // Must not use string.GetHashCode(), which is randomized per process — ids would change on
        // every API restart and the client would treat every contract as new.
        Assert.Equal(CtrmSyntheticId.From("PWW227420"), CtrmSyntheticId.From("PWW227420"));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void IgnoresSurroundingWhitespace()
    {
        Assert.Equal(CtrmSyntheticId.From("PWW227420"), CtrmSyntheticId.From("  PWW227420 "));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void DifferentKeys_ProduceDifferentIds()
    {
        // The paired sale/purchase case: same contract number, different prefix.
        Assert.NotEqual(CtrmSyntheticId.From("SEW659816"), CtrmSyntheticId.From("PEW659816"));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void CompositeKeys_AreNotAmbiguousAcrossPartBoundaries()
    {
        // Joined with a separator that cannot appear in a key, so ("AB","C") and ("A","BC") differ.
        Assert.NotEqual(CtrmSyntheticId.From("AB", "C"), CtrmSyntheticId.From("A", "BC"));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("PWW227420")]
    [InlineData("SEW659816")]
    [InlineData("T/378371")]
    [InlineData("")]
    public void StaysInsideTheReservedBand_AndSurvivesAJavaScriptNumber(string key)
    {
        var id = CtrmSyntheticId.From(key);

        Assert.True(CtrmSyntheticId.IsSynthetic(id));
        Assert.InRange(id, CtrmSyntheticId.ReservedBase, CtrmSyntheticId.ReservedBase + CtrmSyntheticId.Span);
        // Above this, the browser rounds the value and distinct contracts can share a dedup key.
        Assert.True(id <= MaxSafeInteger, $"{id} exceeds Number.MAX_SAFE_INTEGER");
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void OdsScaleIds_AreNotMistakenForSynthetic()
    {
        // Real ODS ContractId/TicketId values sit far below the reserved band.
        Assert.False(CtrmSyntheticId.IsSynthetic(0));
        Assert.False(CtrmSyntheticId.IsSynthetic(1_234_567));
        Assert.False(CtrmSyntheticId.IsSynthetic(999_999_999_999));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ManyDistinctKeys_DoNotCollide()
    {
        // Guards the modulo reduction into the band. A collision here is a wrong row on screen, so it
        // is worth asserting rather than assuming.
        var ids = Enumerable.Range(0, 20_000)
            .Select(i => CtrmSyntheticId.From($"PWW{i:D6}"))
            .ToHashSet();

        Assert.Equal(20_000, ids.Count);
    }
}
