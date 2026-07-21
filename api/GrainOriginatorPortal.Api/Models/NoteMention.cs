using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

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
    // Explicit lowercase JSON names: the Notes.Mentions column is written with a plain
    // JsonSerializer.Serialize (default PascalCase), but the Instant Share Note Logic App reads
    // these keys case-sensitively as lowercase (item()?['type'/'id'/'email']). These attributes
    // force the stored JSON to match that contract (and keep the HTTP shape identical).
    [Required]
    [StringLength(20)]
    [JsonPropertyName("type")]
    public required string Type { get; init; }   // "person" | "trade-unit" | "trade-unit-group"

    [Required]
    [StringLength(256)]
    [JsonPropertyName("id")]
    public required string Id { get; init; }      // UPN (person) | TU code | TU-group id

    [Required]
    [StringLength(256)]
    [JsonPropertyName("name")]
    public required string Name { get; init; }    // display name

    [StringLength(256)]
    [JsonPropertyName("email")]
    public string? Email { get; init; }           // only for person; TU/group re-resolved later
}
