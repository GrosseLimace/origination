using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// One rule, two callers (recap groups and the channel registry). A laxer second copy would be a way
/// around the first, so the shared helper is pinned here directly.
/// </summary>
public class TeamsChannelAddressTests
{
    [Theory]
    [InlineData("abcd1234.scoular.com@amer.teams.ms")]
    [InlineData("ABCD1234.SCOULAR.COM@AMER.TEAMS.MS")]   // case must not matter
    [InlineData("  abcd1234.scoular.com@amer.teams.ms  ")] // surrounding space is trimmed
    public void AcceptsAScoularChannel(string address) =>
        Assert.True(TeamsChannelAddress.IsScoularChannel(address));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abcd1234.contoso.com@amer.teams.ms")]            // foreign tenant
    [InlineData("abcd1234.scoular.com@amer.teams.ms.evil.com")]   // foreign host
    [InlineData("scoular.com@amer.teams.ms")]                     // no ".scoular.com" suffix
    [InlineData("someone@scoular.com")]                           // a person, not a channel
    public void RejectsEverythingElse(string? address) =>
        Assert.False(TeamsChannelAddress.IsScoularChannel(address));
}
