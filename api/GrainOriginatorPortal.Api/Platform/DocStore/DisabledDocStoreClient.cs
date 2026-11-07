using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Platform.DocStore;

/// <summary>
/// Doc Store isn't configured in this environment (DocStore:Mode is empty, or "Http" without BaseUrl and
/// Scope): every call is a 503 that says so, so a documents screen shows a clear message and nothing is ever
/// mistaken for a saved document (a confirmed 45Z CI for a saved report, say).
/// </summary>
public sealed class DisabledDocStoreClient : IDocStoreClient
{
    public const string ErrorCode = "DOC_STORE_NOT_CONFIGURED";

    private static InfrastructureException Off() =>
        new("Doc Store isn't set up in this environment yet, so documents can't be saved or opened.", ErrorCode);

    public Task<DocStoreDocument> UploadAsync(DocStoreUpload upload, CancellationToken ct) => throw Off();
    public Task<DocStoreContent?> DownloadAsync(string documentId, CancellationToken ct) => throw Off();
}
