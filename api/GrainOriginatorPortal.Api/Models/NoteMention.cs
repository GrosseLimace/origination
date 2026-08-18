using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// A single "@" mention attached to a note — a person, trade unit, trade-unit group, or one of the
/// caller's own groups. Mirrors the Daily Digest <c>RecapMember</c> / <c>DailyRecapGroupMember</c>
/// shape so the same email-resolution logic applies when the Logic App reads these:
/// person mentions carry an email; trade-unit / group mentions are re-resolved at send time.
/// Persisted as a JSON array in the Notes.Mentions column (see <see cref="Note.MentionsJson"/>).
/// <para>
/// An <c>app-group</c> mention is FLATTENED server-side (<c>NoteService.ExpandGroupsAsync</c>) into
/// one row per group member, each typed with one of the three types the Logic App already resolves.
/// The app-group row itself is kept for display/provenance and lands in the Logic App switch's
/// no-op <c>Case_app-group</c>, contributing no recipients of its own.
/// </para>
/// </summary>
public record NoteMention
{
    /// <summary>Every mention type the API accepts. Also the exact set the Instant Share Note Logic
    /// App switches on — keep the two in step, and see <see cref="Type"/> for why this matters.</summary>
    public const string PersonType = "person";
    public const string TradeUnitType = "trade-unit";
    public const string TradeUnitGroupType = "trade-unit-group";
    /// <summary>One of the caller's own groups (a Daily Recap group). Named for its SOURCE — "the
    /// app's own groups" — deliberately NOT "user-group", which is the Entitlements table the Logic
    /// App queries to resolve <see cref="TradeUnitGroupType"/> members.</summary>
    public const string AppGroupType = "app-group";

    // Explicit lowercase JSON names: the Notes.Mentions column is written with a plain
    // JsonSerializer.Serialize (default PascalCase), but the Instant Share Note Logic App reads
    // these keys case-sensitively as lowercase (item()?['type'/'id'/'email']). These attributes
    // force the stored JSON to match that contract (and keep the HTTP shape identical).

    // Constrained on purpose: the persisted Mentions drive a Logic App that mails the note from a
    // privileged shared mailbox, and an unrecognized type falls into a switch branch that resolves
    // NOBODY — so an unvalidated type produces a note the author believes was shared and that
    // reached no one, with no error anywhere. Failing the request is the loud alternative.
    [Required]
    [StringLength(20)]
    [AllowedValues(PersonType, TradeUnitType, TradeUnitGroupType, AppGroupType,
        ErrorMessage = "Unknown mention type.")]
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    [Required]
    [StringLength(256)]
    [JsonPropertyName("id")]
    public required string Id { get; init; }      // UPN (person) | TU code | TU-group id | group id

    [Required]
    [StringLength(256)]
    [JsonPropertyName("name")]
    public required string Name { get; init; }    // display name

    [StringLength(256)]
    [JsonPropertyName("email")]
    public string? Email { get; init; }           // only for person; TU/group re-resolved later

    /// <summary>Provenance, SERVER-SET ONLY: <c>"app-group:7"</c> on a row flattened out of group 7,
    /// null on a row the user picked directly. The expansion clears whatever the client sent, so this
    /// can't be forged. Display-only — the client excludes these rows when building the "@name"
    /// highlight tokens, so expanded members never light up text the author didn't type.</summary>
    [StringLength(64)]
    [JsonPropertyName("via")]
    public string? Via { get; init; }
}
