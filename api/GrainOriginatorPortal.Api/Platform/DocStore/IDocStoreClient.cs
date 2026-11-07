namespace GrainOriginatorPortal.Api.Platform.DocStore;

/// <summary>
/// Scoular's Doc Store (repo IT/docstore): documents filed by category with free-form JSON metadata, reached
/// through APIM with the app's managed identity. Doc Store has no end-user screens, so the feature that files a
/// document is its UI. Each feature files under its own category (the 45Z documents use Sustainability-45z),
/// and the app's managed identity must be granted every category it uses.
///
/// Doc Store can't list a category's documents by metadata (its search is full-text and returns no
/// metadata), so a feature keeps its own row per document (the 45Z documents use dbo.FieldPlanDocument) and
/// only files and fetches here.
/// </summary>
public interface IDocStoreClient
{
    /// <summary>Files one document under its category, with its metadata, and returns it as stored.</summary>
    Task<DocStoreDocument> UploadAsync(DocStoreUpload upload, CancellationToken ct);

    /// <summary>The document's bytes, or null when it doesn't exist. The caller disposes the stream.</summary>
    Task<DocStoreContent?> DownloadAsync(string documentId, CancellationToken ct);
}

/// <summary>
/// One document to file. <paramref name="Category"/> is the Doc Store category code, which the feature owns.
/// <paramref name="Metadata"/> is the feature's own keys, so anyone reading Doc Store outside the app can tell
/// what a document is.
/// </summary>
public sealed record DocStoreUpload(
    string Category, string FileName, string ContentType, byte[] Content, IReadOnlyDictionary<string, string> Metadata);

public sealed record DocStoreDocument(string Id, string FileName, string ContentType, long Size, DateTime UploadedAt);

public sealed record DocStoreContent(Stream Content, string ContentType, string FileName);

/// <summary>
/// Configuration section "DocStore": how the app reaches Doc Store. Mode: "" (off: every Doc Store call
/// answers 503), "InMemory" (a stand-in that forgets on restart; local development only, refused outside
/// Development) or "Http" (the real Doc Store; needs BaseUrl and Scope, which are per environment in Doc
/// Store's docs/API-USAGE-GUIDE.md and aren't secrets). Categories aren't configured here: each feature names
/// its own.
/// </summary>
public sealed class DocStoreOptions
{
    public const string Section = "DocStore";

    public string Mode { get; set; } = "";
    /// <summary>Doc Store's API base URL behind APIM, e.g. "https://apiqa.scoular.com/internal/docstore/v1".</summary>
    public string BaseUrl { get; set; } = "";
    /// <summary>The scope the managed identity asks a token for, e.g. "api://&lt;doc-store-app-id&gt;/.default".</summary>
    public string Scope { get; set; } = "";
    /// <summary>Largest file accepted, in bytes.</summary>
    public long MaxFileBytes { get; set; } = 10 * 1024 * 1024;
}
