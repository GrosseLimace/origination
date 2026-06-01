using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Create/update payload for a Daily Recap group. Members are references the Logic App
/// re-resolves at send time (person UPN / trade-unit code / trade-unit-group name).</summary>
public record RecapGroupRequest
{
    [Required]
    [StringLength(200)]
    public required string Name { get; init; }

    /// <summary>"email" or "teams".</summary>
    [Required]
    [StringLength(20)]
    public required string DeliveryMethod { get; init; }

    [StringLength(256)]
    public string? TeamsChannelEmail { get; init; }

    public List<RecapGroupMemberRequest> Members { get; init; } = [];

    public List<string> CcEmails { get; init; } = [];
}

public record RecapGroupMemberRequest
{
    /// <summary>"person" | "trade-unit" | "trade-unit-group".</summary>
    [Required]
    [StringLength(20)]
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
