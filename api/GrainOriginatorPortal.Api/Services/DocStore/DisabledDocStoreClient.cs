using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Services.DocStore;

/// <summary>
/// Doc Store isn't configured in this environment (DocStore:Mode is empty, or "Http" without BaseUrl and
/// Scope): every call is a 503 that says so, so the 45Z documents dialog shows a clear message and a confirmed
/// CI is never mistaken for a saved report.
/// </summary>
public sealed class DisabledDocStoreClient : IDocStoreClient
{
    public const string ErrorCode = "DOC_STORE_NOT_CONFIGURED";

    private static InfrastructureException Off() =>
        new("Doc Store isn't set up in this environment yet, so 45Z documents can't be saved or opened.", ErrorCode);

    public Task<DocStoreDocument> UploadAsync(DocStoreUpload upload, CancellationToken ct) => throw Off();
    public Task<DocStoreContent?> DownloadAsync(string documentId, CancellationToken ct) => throw Off();
}
