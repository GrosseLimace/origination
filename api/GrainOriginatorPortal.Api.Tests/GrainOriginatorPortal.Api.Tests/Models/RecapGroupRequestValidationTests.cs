using System.ComponentModel.DataAnnotations;

using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Data-annotation + IValidatableObject rules on <see cref="RecapGroupRequest"/>: CC addresses are
/// confined to @scoular.com (no external forwarding), a group must keep at least one member, and a
/// Teams group must carry a valid *.teams.ms
/// channel address (so the workflow never falls back to a shared channel).
/// </summary>
public class RecapGroupRequestValidationTests
{
    private static List<ValidationResult> Validate(RecapGroupRequest req)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(req, new ValidationContext(req), results, validateAllProperties: true);
        return results;
    }

    // Carries one member because an empty group is rejected outright — that keeps every test below
    // isolated to the rule it is actually about.
    private static RecapGroupRequest Base() => new()
    {
        Name = "Daily",
        DeliveryMethod = "email",
        Members = [new RecapGroupMemberRequest { Type = "person", Id = "sam", Name = "Sam Smith" }],
    };

    // ── CC domain ────────────────────────────────────────────────────────────
    [Fact]
    public void Cc_ExternalDomain_IsRejected()
    {
        var req = Base() with { CcEmails = ["me@gmail.com"] };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.ErrorMessage!.Contains("@scoular.com"));
    }

    [Fact]
    public void Cc_ScoularDomain_IsAccepted()
    {
        var req = Base() with { CcEmails = ["teammate@scoular.com"] };

        Assert.Empty(Validate(req));
    }

    // ── Teams channel ─────────────────────────────────────────────────────────
    [Fact]
    public void Teams_WithoutChannel_IsRejected()
    {
        var req = Base() with { DeliveryMethod = "teams", TeamsChannelEmail = null };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RecapGroupRequest.TeamsChannelEmail)));
    }

    [Fact]
    public void Teams_WithNonChannelEmail_IsRejected()
    {
        var req = Base() with { DeliveryMethod = "teams", TeamsChannelEmail = "someone@scoular.com" };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.ErrorMessage!.Contains(".teams.ms"));
    }

    [Fact]
    public void Teams_WithValidScoularChannelAddress_IsAccepted()
    {
        var req = Base() with { DeliveryMethod = "teams", TeamsChannelEmail = "8e5da312.scoular.com@amer.teams.ms" };

        Assert.Empty(Validate(req));
    }

    [Fact]
    public void Teams_WithForeignTenantChannel_IsRejected()
    {
        // Same *.teams.ms host, but the local part is another tenant's domain — must be blocked so a
        // recap can't be routed to a channel outside the Scoular tenant.
        var req = Base() with { DeliveryMethod = "teams", TeamsChannelEmail = "abcd1234.contoso.com@amer.teams.ms" };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RecapGroupRequest.TeamsChannelEmail)));
    }

    [Fact]
    public void Email_Delivery_DoesNotRequireTeamsChannel()
    {
        var req = Base() with { DeliveryMethod = "email", TeamsChannelEmail = null };

        Assert.Empty(Validate(req));
    }

    // ── Membership floor ──────────────────────────────────────────────────────
    [Fact]
    public void Members_Empty_IsRejected()
    {
        // Any member can edit a group, so nothing else stops one from stripping every member and
        // silently making the group unmentionable and undeliverable. The client already requires at
        // least one; this is the server-side floor.
        var req = Base() with { Members = [] };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RecapGroupRequest.Members)));
    }

    // ── @-mentions routed to the Teams channel ────────────────────────────────
    private const string ScoularChannel = "abcd1234.scoular.com@amer.teams.ms";

    [Fact]
    public void MentionsToChannel_WithNoMembers_IsAccepted()
    {
        // The whole point of the feature: a channel entry is a recipient in its own right, so it
        // needs nobody in it. Members stay optional and mean "who can see and mention this".
        var req = Base() with
        {
            DeliveryMethod = "teams",
            TeamsChannelEmail = ScoularChannel,
            MentionsToChannel = true,
            Members = [],
        };

        Assert.Empty(Validate(req));
    }

    [Fact]
    public void MentionsToChannel_WithEmailDelivery_IsRejected()
    {
        // There is no channel to post to, so the flag would silently do nothing.
        var req = Base() with { DeliveryMethod = "email", MentionsToChannel = true };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RecapGroupRequest.MentionsToChannel)));
    }

    [Fact]
    public void MentionsToChannel_StillRequiresAScoularChannelAddress()
    {
        // Channel routing must not become a way around the tenant pin.
        var req = Base() with
        {
            DeliveryMethod = "teams",
            TeamsChannelEmail = "abcd1234.contoso.com@amer.teams.ms",
            MentionsToChannel = true,
            Members = [],
        };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RecapGroupRequest.TeamsChannelEmail)));
    }

    [Fact]
    public void Members_Empty_WithoutChannelRouting_IsStillRejected()
    {
        // Teams delivery alone does not buy the members exemption — only channel routing does.
        var req = Base() with
        {
            DeliveryMethod = "teams",
            TeamsChannelEmail = ScoularChannel,
            MentionsToChannel = false,
            Members = [],
        };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RecapGroupRequest.Members)));
    }

    [Fact]
    public void DailyRecap_OnAMemberlessGroup_IsRejected()
    {
        // The recap is built from the notes the MEMBERS can see, so a memberless channel entry
        // would schedule an empty send every evening.
        var req = Base() with
        {
            DeliveryMethod = "teams",
            TeamsChannelEmail = ScoularChannel,
            MentionsToChannel = true,
            Members = [],
            Enabled = true,
        };

        var errors = Validate(req);

        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(RecapGroupRequest.Enabled)));
    }
}
