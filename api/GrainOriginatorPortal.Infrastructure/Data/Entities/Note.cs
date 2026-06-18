using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Represents a contact note or activity log entry for a customer.
/// Stored in Origination.dbo.Notes table (application-managed data).
/// </summary>
public class Note
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? CustomerCode { get; set; }
    public string? TradeUnit { get; set; }
    public string Description { get; set; } = string.Empty;
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }
    public bool IsPinned { get; set; }

    // Future-use column. Added to the schema now so it's ready; the application does not
    // yet read or write it.
    public string? Subject { get; set; }

    // Soft-delete fields. Notes are never hard-deleted so a record can be recovered.
    // Reads filter on IsDeleted = false; the row stays in the table with DeletedAt/DeletedBy
    // populated for audit + restoration.
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }

    // Computed alias for frontend compatibility
    public string Content => Description;

    // Backs the Notes.Mentions column (nvarchar(max)) — the raw JSON array of "@" mentions.
    // The structured, API-facing list is exposed on NoteResponse and (de)serialized in the Api
    // mapping layer, keeping this Infrastructure entity free of Api-layer types.
    public string? MentionsJson { get; set; }

    // Navigation property — FK to dbo.Customer. Populated via Include() so the
    // service layer can copy CustomerName / CustomerCode onto the DTO without
    // those columns being stored on the Notes table.
    // [JsonIgnore] keeps the nested Customer out of API responses; the flat
    // CustomerName / CustomerCode properties on Note carry the customer info.
    [JsonIgnore]
    public Customer? Customer { get; set; }
}
