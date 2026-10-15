using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>Schema <c>RecentNotes</c> (card #644): pinned note first, then the newest up to the cap.</summary>
public sealed record RecentNotesDto
{
    public NoteDto? Pinned { get; init; }
    public required IReadOnlyList<NoteDto> Notes { get; init; }
    public required bool HasMore { get; init; }
}

/// <summary>Schema <c>Note</c>.</summary>
public sealed record NoteDto
{
    public required int Id { get; init; }
    public required long CustomerId { get; init; }
    public string? Subject { get; init; }
    public required string Content { get; init; }
    public required string CreatedBy { get; init; }
    public required DateTime CreatedAt { get; init; }
    public required bool IsPinned { get; init; }
}

/// <summary>Schema <c>NoteCreate</c>. Offline-queued on the client; replay with the same id returns the original note.</summary>
public sealed record NoteCreateRequest
{
    [Required]
    public required Guid ClientRequestId { get; init; }

    [Required, MinLength(1), MaxLength(4000)]
    public required string Content { get; init; }

    /// <summary>When the note was written on the device; may predate the sync. Logged, not persisted.</summary>
    public DateTime? CapturedAt { get; init; }
}
