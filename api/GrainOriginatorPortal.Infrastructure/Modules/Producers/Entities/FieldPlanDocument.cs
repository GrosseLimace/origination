namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

/// <summary>
/// One of a producer's 45Z documents kept in Doc Store (category Sustainability-45z): which producer, crop
/// year and, for a Biofuel Feedstock Report, which field it belongs to. Doc Store holds the file and the same
/// values as metadata, but it can't list a category's documents by metadata, so this row is how the 45Z
/// documents dialog finds them and how a download is checked against the producer. Never deleted, and the file
/// in Doc Store is never replaced: only <see cref="Status"/> changes. A re-confirmed field's new report and
/// ledger mark the previous ones Overwritten; an originator can mark any document Archived (and restore it).
/// Both stay in the dialog's version history.
/// </summary>
public class FieldPlanDocument
{
    public const string Current = "Current";
    /// <summary>Replaced by a newer report or ledger when the field's CI was confirmed again.</summary>
    public const string Overwritten = "Overwritten";
    /// <summary>Set aside by an originator, e.g. no longer relevant to the year.</summary>
    public const string Archived = "Archived";

    public int Id { get; set; }
    /// <summary>Doc Store's document id (a GUID).</summary>
    public string DocStoreId { get; set; } = string.Empty;
    public long CustomerId { get; set; }
    public int CropYear { get; set; }
    /// <summary>"FeedstockReport", "MassBalanceLedger", "ProducerAttestation" or "Other".</summary>
    public string DocumentType { get; set; } = string.Empty;
    /// <summary>The confirmed 45Z record a report or ledger was saved from (the field and year); null for uploads.</summary>
    public int? FieldProgramRecordId { get; set; }
    public string? SplitId { get; set; }
    /// <summary>The field's name when its report or ledger was saved.</summary>
    public string? FieldName { get; set; }
    public string? Commodity { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>The originator's UPN.</summary>
    public string CreatedBy { get; set; } = string.Empty;
    public string? CreatedByName { get; set; }

    /// <summary><see cref="Current"/>, <see cref="Overwritten"/> or <see cref="Archived"/>.</summary>
    public string Status { get; set; } = Current;
    /// <summary>When it was last overwritten, archived or restored, and by whom (UPN and display name).</summary>
    public DateTime? StatusChangedAt { get; set; }
    public string? StatusChangedBy { get; set; }
    public string? StatusChangedByName { get; set; }
    /// <summary>The originator's reason for archiving, if they gave one.</summary>
    public string? StatusNote { get; set; }
    /// <summary>For an overwritten report or ledger, the Doc Store id of the one that replaced it.</summary>
    public string? ReplacedByDocStoreId { get; set; }
}
