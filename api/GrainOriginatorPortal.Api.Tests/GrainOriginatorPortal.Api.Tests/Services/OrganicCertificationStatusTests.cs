// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The shared certification status rules. These matter more than their size suggests: the producer
/// profile and Actionable Insights consume the same rule from different layers, so a change here
/// moves both surfaces at once — which is the entire reason the rule lives in one place.
/// </summary>
public class OrganicCertificationStatusTests
{
    [Theory]
    [InlineData("Certified", true)]
    [InlineData("certified", true)]      // source is inconsistent about casing
    [InlineData("  Certified  ", true)]  // and about padding
    [InlineData("Surrendered", false)]
    [InlineData("Suspended", false)]
    [InlineData("Revoked", false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData(null, false)]
    public void IsCertifiedRecognisesOnlyCertified(string? status, bool expected)
    {
        Assert.Equal(expected, OrganicCertificationStatus.IsCertified(status));
    }

    [Fact]
    public void AnUnrecognisedStatusIsTreatedAsNotCertified()
    {
        // Fails safe. USDA inventing a new terminal status tomorrow should raise a flag for someone
        // to look at, never silently pass as good standing.
        Assert.False(OrganicCertificationStatus.IsCertified("Withdrawn By Certifier"));
        Assert.True(OrganicCertificationStatus.HasUnresolvedStatusChange(
            "Withdrawn By Certifier", previousStatus: "Certified"));
    }

    [Fact]
    public void AChangeAwayFromCertifiedStaysFlagged()
    {
        Assert.True(OrganicCertificationStatus.HasUnresolvedStatusChange(
            currentStatus: "Surrendered", previousStatus: "Certified"));
    }

    [Fact]
    public void ReturningToCertifiedClearsTheFlag()
    {
        // The resolution event, per Madeline 2026-09-24. No separate dismissal step: reinstatement
        // clears it by itself, so nobody has to remember to tidy up.
        Assert.False(OrganicCertificationStatus.HasUnresolvedStatusChange(
            currentStatus: "Certified", previousStatus: "Suspended"));
    }

    [Fact]
    public void AProducerWeFirstMetAsSurrenderedIsNotFlagged()
    {
        // No previous status means no observed change. They did not lapse on our watch — we simply
        // met them that way, and announcing a change that never happened would be wrong.
        Assert.False(OrganicCertificationStatus.HasUnresolvedStatusChange(
            currentStatus: "Surrendered", previousStatus: null));
    }

    [Fact]
    public void TheFlagIsNotTimeLimited()
    {
        // Deliberately state-based rather than a rolling window. A producer that went Surrendered
        // long ago and has never been reinstated is still unresolved, and the desk still needs it.
        // There is no date input here at all — that absence is the assertion.
        Assert.True(OrganicCertificationStatus.HasUnresolvedStatusChange("Revoked", "Certified"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void AnEmptyPreviousStatusIsNotAChange(string previous)
    {
        // Guards against a blank slipping through where null was expected and producing a flag
        // with nothing to display next to it.
        Assert.False(OrganicCertificationStatus.HasUnresolvedStatusChange("Surrendered", previous));
    }

    // ── NeedsAttention ───────────────────────────────────────────────────────────────────────
    // Broader than HasUnresolvedStatusChange: no observed change required. Added 2026-10-07 when
    // the desk asked for producers who were already surrendered the first time we saw them, who
    // until then appeared on no list at all.

    [Theory]
    [InlineData("Certified", false)]
    [InlineData("certified", false)]
    [InlineData("Surrendered", true)]
    [InlineData("Suspended", true)]
    [InlineData("Revoked", true)]
    [InlineData("Something USDA Invented", true)]  // unknown must flag, never slip through
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void NeedsAttentionFlagsAnythingNotCertified(string? status, bool expected)
        => Assert.Equal(expected, OrganicCertificationStatus.NeedsAttention(status));

    [Fact]
    public void NeedsAttentionDoesNotRequireAnObservedChange()
    {
        // The whole point of it existing alongside HasUnresolvedStatusChange.
        Assert.True(OrganicCertificationStatus.NeedsAttention("Surrendered"));
        Assert.False(OrganicCertificationStatus.HasUnresolvedStatusChange("Surrendered", previousStatus: null));
    }

    // ── IsSurrendered — the red badge ────────────────────────────────────────────────────────

    private static (string?, string?)[] Scopes(params (string?, string?)[] scopes) => scopes;

    [Fact]
    public void OperationLevelSurrenderRedddensTheBadge()
        => Assert.True(OrganicCertificationStatus.IsSurrendered("Surrendered", Scopes()));

    [Fact]
    public void ASurrenderedCropsScopeReddensTheBadge()
        => Assert.True(OrganicCertificationStatus.IsSurrendered(
            "Certified", Scopes(("Crops", "Surrendered"))));

    [Fact]
    public void ASurrenderedHandlingScopeReddensTheBadge()
    {
        // Kate Hoegermeyer, 2026-10-07, correcting the first version of this rule: SOME FAMILY
        // OPERATIONS TRADE UNDER A HANDLING CERTIFICATE rather than a crops one. Excluding
        // Handling left exactly those producers looking fine when they are not.
        Assert.True(OrganicCertificationStatus.IsSurrendered(
            "Certified", Scopes(("Handling", "Surrendered"))));
    }

    [Fact]
    public void ASurrenderedLivestockScopeDoesNotReddenTheBadge()
    {
        // The only scope that does not count. Scoular buys grain — giving up a livestock
        // certificate does not change what we can buy from them.
        Assert.False(OrganicCertificationStatus.IsSurrendered(
            "Certified", Scopes(("Livestock", "Surrendered"))));
    }

    [Fact]
    public void AFullyCertifiedOperationIsNotSurrendered()
        => Assert.False(OrganicCertificationStatus.IsSurrendered(
            "Certified", Scopes(("Crops", "Certified"), ("Handling", "Certified"))));

    [Fact]
    public void SuspendedIsNotSurrendered()
    {
        // Red is reserved for Surrendered specifically. Suspended still flags in Actionable
        // Insights and still carries the amber dot — it is just not the red state.
        Assert.False(OrganicCertificationStatus.IsSurrendered(
            "Suspended", Scopes(("Crops", "Suspended"))));
    }

    [Theory]
    [InlineData("crops")]
    [InlineData("  Handling  ")]
    [InlineData("HANDLING")]
    public void ScopeMatchingIsTrimmedAndCaseInsensitive(string scope)
        => Assert.True(OrganicCertificationStatus.IsSurrendered(
            "Certified", Scopes((scope, "surrendered"))));

    [Fact]
    public void NoScopesAtAllIsNotSurrendered()
    {
        // A surrendered operation arrives with an empty items list and can arrive with no scopes;
        // that must not throw and must not redden on its own.
        Assert.False(OrganicCertificationStatus.IsSurrendered("Certified", Scopes()));
        Assert.False(OrganicCertificationStatus.IsSurrendered(null, Scopes()));
    }
}
