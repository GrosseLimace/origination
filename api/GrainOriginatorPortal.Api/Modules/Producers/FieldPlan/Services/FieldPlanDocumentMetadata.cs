namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;

/// <summary>
/// Where the 45Z documents go in Doc Store, and the metadata keys they're filed with, so anyone reading Doc
/// Store outside the app can tell what a document is. Origination itself reads its own rows
/// (dbo.FieldPlanDocument), not these.
/// </summary>
public static class FieldPlanDocumentMetadata
{
    /// <summary>The Doc Store category code (from Charlie, 2026-11-05). The app's managed identity is granted it.</summary>
    public const string Category = "Sustainability-45z";

    public const string DocumentType = "documentType";
    /// <summary>Origination's dbo.Customer id.</summary>
    public const string CustomerId = "customerId";
    /// <summary>The producer's CTRM code (Customer.ScoularId).</summary>
    public const string ProducerCode = "producerCode";
    public const string CropYear = "cropYear";
    public const string SplitId = "splitId";
    public const string FieldName = "fieldName";
    public const string Commodity = "commodity";
    public const string FieldProgramRecordId = "fieldProgramRecordId";
    /// <summary>When the CI the report shows was confirmed (Official.documentedAt), so a re-confirmed field's reports stay apart.</summary>
    public const string ConfirmedAt = "confirmedAt";
    /// <summary>The originator (UPN): Doc Store sees only the app's managed identity, so the person is kept here.</summary>
    public const string UploadedBy = "uploadedBy";
    public const string UploadedByName = "uploadedByName";
}
