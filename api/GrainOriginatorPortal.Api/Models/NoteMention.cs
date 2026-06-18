using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// A single "@" mention attached to a note — a person, trade unit, or trade-unit group.
/// Mirrors the Daily Digest <c>RecapMember</c> / <c>DailyRecapGroupMember</c> shape so the
/// same email-resolution logic applies when a future endpoint hands these to the Logic App:
/// person mentions carry an email; trade-unit / group mentions are re-resolved at send time.
/// Persisted as a JSON array in the Notes.Mentions column (see <see cref="Note.MentionsJson"/>).
/// </summary>
public record NoteMention
{
    [Required]
    [StringLength(20)]
    public required string Type { get; init; }   // "person" | "trade-unit" | "trade-unit-group" | "recap-group"

    [Required]
    [StringLength(256)]
    public required string Id { get; init; }      // UPN (person) | TU code | TU-group id | RecapGroupId

    [Required]
    [StringLength(256)]
    public required string Name { get; init; }    // display name

    [StringLength(256)]
    public string? Email { get; init; }           // only for person; TU/group re-resolved later
}
