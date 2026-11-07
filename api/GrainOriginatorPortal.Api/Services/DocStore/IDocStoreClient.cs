namespace GrainOriginatorPortal.Api.Services.DocStore;

/// <summary>
/// Scoular's Doc Store (repo IT/docstore): documents filed by category with free-form JSON metadata, reached
/// through APIM with the app's managed identity. Doc Store has no end-user screens, so Origination's 45Z
/// documents dialog is the UI for the Sustainability-45z category.
///
/// Doc Store can't list a category's documents by metadata (its search is full-text and returns no
/// metadata), so Origination keeps its own row per document (dbo.FieldPlanDocument) and only files and
/// fetches here. Callers never pass a category: each client is configured with one.
/// </summary>
public interface IDocStoreClient
{
    /// <summary>Files one document with its metadata and returns it as stored.</summary>
    Task<DocStoreDocument> UploadAsync(DocStoreUpload upload, CancellationToken ct);

    /// <summary>The document's bytes, or null when it doesn't exist. The caller disposes the stream.</summary>
    Task<DocStoreContent?> DownloadAsync(string documentId, CancellationToken ct);
}

public sealed record DocStoreUpload(string FileName, string ContentType, byte[] Content, IReadOnlyDictionary<string, string> Metadata);

public sealed record DocStoreDocument(string Id, string FileName, string ContentType, long Size, DateTime UploadedAt);

public sealed record DocStoreContent(Stream Content, string ContentType, string FileName);

/// <summary>
/// Origination's metadata keys on 45Z documents, so anyone reading Doc Store outside the app can tell what a
/// document is. Origination itself reads its own rows, not these.
/// </summary>
public static class DocStoreMetadata
{
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

/// <summary>
/// Configuration section "DocStore". Mode: "" (off: the 45Z documents routes answer 503), "InMemory" (a
/// stand-in that forgets on restart; local development only, refused outside Development) or "Http" (the real
/// Doc Store; needs BaseUrl and Scope, which are per environment in Doc Store's docs/API-USAGE-GUIDE.md and
/// aren't secrets).
/// </summary>
public sealed class DocStoreOptions
{
    public const string Section = "DocStore";

    public string Mode { get; set; } = "";
    /// <summary>Doc Store's API base URL behind APIM, e.g. "https://apiqa.scoular.com/internal/docstore/v1".</summary>
    public string BaseUrl { get; set; } = "";
    /// <summary>The scope the managed identity asks a token for, e.g. "api://&lt;doc-store-app-id&gt;/.default".</summary>
    public string Scope { get; set; } = "";
    /// <summary>The Doc Store category code (from Charlie, 2026-11-05).</summary>
    public string Category { get; set; } = "Sustainability-45z";
    /// <summary>Largest file accepted, in bytes.</summary>
    public long MaxFileBytes { get; set; } = 10 * 1024 * 1024;
}
