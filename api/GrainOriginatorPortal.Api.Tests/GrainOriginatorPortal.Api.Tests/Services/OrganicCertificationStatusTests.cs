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
}
