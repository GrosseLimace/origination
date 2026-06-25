using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Create/update payload for a Daily Recap group. Members are references the Logic App
/// re-resolves at send time (person UPN / trade-unit code / trade-unit-group name).</summary>
public record RecapGroupRequest : IValidatableObject
{
    [Required]
    [StringLength(200)]
    public required string Name { get; init; }

    /// <summary>"email" or "teams".</summary>
    [Required]
    [StringLength(20)]
    [AllowedValues("email", "teams", ErrorMessage = "DeliveryMethod must be 'email' or 'teams'.")]
    public required string DeliveryMethod { get; init; }

    [StringLength(256)]
    public string? TeamsChannelEmail { get; init; }

    [MaxLength(500, ErrorMessage = "A recap group cannot have more than 500 members.")]
    public List<RecapGroupMemberRequest> Members { get; init; } = [];

    // CC addresses are restricted to @scoular.com so a recap can't be forwarded to an arbitrary
    // external mailbox; EmailList also caps the count (≤50) and per-item length/format.
    [EmailList(RequiredDomain = "scoular.com")]
    public List<string> CcEmails { get; init; } = [];

    /// <summary>A "teams" group MUST carry a valid Teams channel address (a <c>*.teams.ms</c> "send to
    /// channel" email). The Logic App routes to this per-group address and fails closed without it, so
    /// reject the save here rather than letting a group fall back to a shared channel.</summary>
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!string.Equals(DeliveryMethod, "teams", StringComparison.OrdinalIgnoreCase))
            yield break;

        var channel = TeamsChannelEmail?.Trim();
        if (string.IsNullOrWhiteSpace(channel))
        {
            yield return new ValidationResult(
                "A Teams delivery group requires a Teams channel email address.", [nameof(TeamsChannelEmail)]);
            yield break;
        }

        // Teams "send to channel" addresses are real emails on a *.teams.ms host.
        if (!new EmailAddressAttribute().IsValid(channel)
            || !channel.EndsWith(".teams.ms", StringComparison.OrdinalIgnoreCase))
            yield return new ValidationResult(
                "TeamsChannelEmail must be a valid Teams channel address (ending in .teams.ms).",
                [nameof(TeamsChannelEmail)]);
    }
}

public record RecapGroupMemberRequest
{
    /// <summary>"person" | "trade-unit" | "trade-unit-group".</summary>
    [Required]
    [StringLength(20)]
    [AllowedValues("person", "trade-unit", "trade-unit-group", ErrorMessage = "Type must be 'person', 'trade-unit', or 'trade-unit-group'.")]
    public required string Type { get; init; }

    /// <summary>Entitlements id: UPN (person), TU code (trade-unit), group name (trade-unit-group).</summary>
    [Required]
    [StringLength(256)]
    public required string Id { get; init; }

    [Required]
    [StringLength(256)]
    public required string Name { get; init; }

    [StringLength(256)]
    public string? Email { get; init; }
}

/// <summary>Body for the lightweight enable/disable toggle endpoint.</summary>
public record RecapGroupEnabledRequest
{
    public required bool Enabled { get; init; }
}
