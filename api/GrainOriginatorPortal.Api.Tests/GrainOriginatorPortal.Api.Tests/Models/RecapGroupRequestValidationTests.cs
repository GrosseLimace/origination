using System.ComponentModel.DataAnnotations;

using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Data-annotation + IValidatableObject rules on <see cref="RecapGroupRequest"/>: CC addresses are
/// confined to @scoular.com (no external forwarding) and a Teams group must carry a valid *.teams.ms
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

    private static RecapGroupRequest Base() => new() { Name = "Daily", DeliveryMethod = "email" };

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
}
