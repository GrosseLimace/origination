namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Per-customer "last contacted" aggregate projected from dbo.Notes. Not a mapped entity —
/// query-projection shape only. One row per customer that has at least one non-deleted note,
/// so the result is bounded by customer count and stays small no matter how many notes
/// accumulate (the full-note bulk read does not).
/// </summary>
public class NoteLastContact
{
    public long CustomerId { get; set; }
    public string? CustomerCode { get; set; }
    public DateTime LastNoteAt { get; set; }
}
