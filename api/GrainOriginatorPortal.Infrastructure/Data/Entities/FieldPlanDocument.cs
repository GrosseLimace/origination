namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One of a producer's 45Z documents kept in Doc Store (category Sustainability-45z): which producer, crop
/// year and, for a Biofuel Feedstock Report, which field it belongs to. Doc Store holds the file and the same
/// values as metadata, but it can't list a category's documents by metadata, so this row is how the 45Z
/// documents dialog finds them and how a download is checked against the producer. Never updated or deleted:
/// a re-confirmed field gets a new report and the old row stays.
/// </summary>
public class FieldPlanDocument
{
    public int Id { get; set; }
    /// <summary>Doc Store's document id (a GUID).</summary>
    public string DocStoreId { get; set; } = string.Empty;
    public long CustomerId { get; set; }
    public int CropYear { get; set; }
    /// <summary>"FeedstockReport", "ProducerAttestation" or "Other".</summary>
    public string DocumentType { get; set; } = string.Empty;
    /// <summary>The confirmed 45Z record a report was saved from; null for uploads.</summary>
    public int? FieldProgramRecordId { get; set; }
    public string? SplitId { get; set; }
    public string? Commodity { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>The originator's UPN.</summary>
    public string CreatedBy { get; set; } = string.Empty;
    public string? CreatedByName { get; set; }
}
