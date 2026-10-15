namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// The producer-list badge feed — one row per OPEN reminder the caller owns, carrying only what a
/// badge needs. Analogous to <see cref="NoteLastContactResponse"/>: bounded by how many follow-ups
/// one person has scheduled, and ships no reminder text.
/// </summary>
public record ReminderDueResponse
{
    public int Id { get; init; }
    public long CustomerId { get; init; }

    /// <summary>ODS producer id. The badge keys on this, matching the last-contact feed.</summary>
    public string? CustomerCode { get; init; }

    /// <summary>When the follow-up is due, in UTC.</summary>
    public DateTime DueAt { get; init; }
}
