using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>What the note composer sends the first time someone picks a Teams channel from the "@"
/// menu. The client read these fields from Microsoft Graph with the signed-in user's own token, so
/// they are treated as untrusted input and the address is re-validated here.</summary>
public record RegisterTeamsChannelRequest : IValidatableObject
{
    [Required]
    [StringLength(100)]
    public required string TeamId { get; init; }

    [Required]
    [StringLength(256)]
    public required string TeamName { get; init; }

    [Required]
    [StringLength(200)]
    public required string ChannelId { get; init; }

    [Required]
    [StringLength(256)]
    public required string DisplayName { get; init; }

    [Required]
    [StringLength(256)]
    public required string ChannelEmail { get; init; }

    /// <summary>The address is the one field that becomes a send target, so it carries the same
    /// Scoular-tenant pin as a recap group's channel. Without this a crafted call to this endpoint
    /// could register a channel in another tenant and make it mentionable to everyone.</summary>
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!TeamsChannelAddress.IsScoularChannel(ChannelEmail))
        {
            yield return new ValidationResult(
                "ChannelEmail must be a Scoular Teams channel address (e.g. <id>.scoular.com@<region>.teams.ms).",
                [nameof(ChannelEmail)]);
        }
    }
}
