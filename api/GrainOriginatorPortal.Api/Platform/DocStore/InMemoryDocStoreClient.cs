using System.Collections.Concurrent;

namespace GrainOriginatorPortal.Api.Platform.DocStore;

/// <summary>
/// A stand-in for Doc Store that keeps documents in memory until the API restarts: for local development and
/// tests. <c>AddDocStore</c> refuses it outside Development, so it can never look like a document was kept in
/// Dev, QA or PROD when it wasn't. After a restart a feature still lists earlier documents (their rows are in
/// its own table), but they can no longer be opened.
/// </summary>
public sealed class InMemoryDocStoreClient : IDocStoreClient
{
    private readonly ConcurrentDictionary<string, (DocStoreDocument Doc, byte[] Content)> _docs = new();
    private readonly TimeProvider _clock;

    public InMemoryDocStoreClient(TimeProvider? clock = null) => _clock = clock ?? TimeProvider.System;

    /// <summary>What each upload was filed with, for tests.</summary>
    public ConcurrentDictionary<string, IReadOnlyDictionary<string, string>> Metadata { get; } = new();

    /// <summary>The category each upload was filed under, for tests.</summary>
    public ConcurrentDictionary<string, string> Categories { get; } = new();

    public Task<DocStoreDocument> UploadAsync(DocStoreUpload upload, CancellationToken ct)
    {
        var doc = new DocStoreDocument(Guid.NewGuid().ToString(), upload.FileName, upload.ContentType, upload.Content.LongLength,
            _clock.GetUtcNow().UtcDateTime);
        _docs[doc.Id] = (doc, upload.Content);
        Metadata[doc.Id] = new Dictionary<string, string>(upload.Metadata);
        Categories[doc.Id] = upload.Category;
        return Task.FromResult(doc);
    }

    public Task<DocStoreContent?> DownloadAsync(string documentId, CancellationToken ct) =>
        Task.FromResult(_docs.TryGetValue(documentId, out var d)
            ? new DocStoreContent(new MemoryStream(d.Content, writable: false), d.Doc.ContentType, d.Doc.FileName)
            : null);
}
