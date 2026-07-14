namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for the per-customer "last contacted" aggregate — one row per customer
/// that has at least one non-deleted, entitlement-visible note. Feeds the customer list's
/// last-contact badges without shipping note bodies.</summary>
public record NoteLastContactResponse
{
    public long CustomerId { get; init; }
    public string? CustomerCode { get; init; }
    public DateTime LastNoteAt { get; init; }
}
