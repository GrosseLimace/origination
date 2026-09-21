using System.ComponentModel.DataAnnotations;

using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// The registration endpoint turns a string into something the shared mailbox will send to, so the
/// address it accepts is the whole security boundary. The client reads these fields from Microsoft
/// Graph, but a hand-crafted call bypasses the client entirely — these pin the tenant check that
/// stops such a call registering a channel in someone else's Microsoft 365 tenant.
/// </summary>
public class RegisterTeamsChannelRequestValidationTests
{
    private static List<ValidationResult> Validate(RegisterTeamsChannelRequest req)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(req, new ValidationContext(req), results, validateAllProperties: true);
        return results;
    }

    private static RegisterTeamsChannelRequest Base() => new()
    {
        TeamId = "19:team-guid",
        TeamName = "Trading",
        ChannelId = "19:channel-guid@thread.tacv2",
        DisplayName = "Grain Desk",
        ChannelEmail = "abcd1234.scoular.com@amer.teams.ms",
    };

    [Fact]
    public void ScoularChannelAddress_IsAccepted()
    {
        Assert.Empty(Validate(Base()));
    }

    [Theory]
    [InlineData("abcd1234.contoso.com@amer.teams.ms")]   // another tenant's channel
    [InlineData("attacker@evil.com")]                     // not a channel address at all
    [InlineData("abcd1234.scoular.com@evil.com")]         // Scoular-looking local part, foreign host
    [InlineData("abcd1234.scoular.com.evil.com@amer.teams.ms")] // lookalike tenant suffix
    [InlineData("")]
    public void NonScoularChannelAddress_IsRejected(string address)
    {
        var errors = Validate(Base() with { ChannelEmail = address });

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RegisterTeamsChannelRequest.ChannelEmail)));
    }
}
