using System.Globalization;
using System.Text.Json.Nodes;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.DocStore;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Options;

namespace GrainOriginatorPortal.Api.Services.FieldPlan;

/// <summary>
/// A producer's 45Z documents in Doc Store (category Sustainability-45z): the Biofuel Feedstock Report saved
/// when a field's CI is confirmed, and what the originator uploads for the producer and crop year (the signed
/// annual attestation, other supporting documents). The server sets every metadata value from its own rows;
/// a request only supplies the file, and for an upload the year and type. Each document gets a
/// dbo.FieldPlanDocument row, which is what the dialog lists and what a download is checked against: a
/// document id from another producer is a 404.
/// </summary>
public interface IFieldPlanDocumentService
{
    Task<IReadOnlyList<FieldPlanDocumentResponse>> ListAsync(long customerId, int? cropYear, CancellationToken ct);
    Task<FieldPlanDocumentResponse> UploadAsync(long customerId, int cropYear, string documentType, IFormFile file, CancellationToken ct);
    Task<FieldPlanDocumentResponse> SaveReportAsync(int recordId, IFormFile file, CancellationToken ct);
    Task<DocStoreContent> DownloadAsync(long customerId, string documentId, CancellationToken ct);
}

/// <inheritdoc />
public sealed class FieldPlanDocumentService : IFieldPlanDocumentService
{
    public const string FeedstockReport = "FeedstockReport";
    public const string ProducerAttestation = "ProducerAttestation";
    public const string Other = "Other";
    /// <summary>What an originator may upload; the report is only ever saved by confirming a field.</summary>
    private static readonly string[] Uploadable = [ProducerAttestation, Other];

    private readonly IDocStoreClient _docStore;
    private readonly IFieldPlanRepository _repository;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<FieldPlanDocumentService> _logger;
    private readonly DocStoreOptions _options;

    public FieldPlanDocumentService(IDocStoreClient docStore, IFieldPlanRepository repository, IRequestContextService requestContext,
        IOptions<DocStoreOptions> options, ILogger<FieldPlanDocumentService> logger)
    {
        _docStore = docStore;
        _repository = repository;
        _requestContext = requestContext;
        _options = options.Value;
        _logger = logger;
    }

    private string User => _requestContext.GetCurrentUser();

    public async Task<IReadOnlyList<FieldPlanDocumentResponse>> ListAsync(long customerId, int? cropYear, CancellationToken ct)
    {
        if (cropYear is { } y) RequireYear(y);
        var docs = await _repository.GetDocumentsAsync(customerId, cropYear, ct);
        return docs.OrderBy(d => d.DocumentType == FeedstockReport).Select(ToResponse).ToList();
    }

    public async Task<FieldPlanDocumentResponse> UploadAsync(long customerId, int cropYear, string documentType, IFormFile file, CancellationToken ct)
    {
        RequireYear(cropYear);
        var type = Uploadable.FirstOrDefault(t => string.Equals(t, documentType?.Trim(), StringComparison.OrdinalIgnoreCase))
            ?? throw new ValidationException("documentType", "Choose Producer attestation or Other.");
        var (exists, producerCode) = await _repository.GetCustomerCodeAsync(customerId, ct);
        if (!exists) throw new NotFoundException("Producer", customerId);
        var (content, contentType, extension) = await ReadAsync(file, ct);

        var metadata = Metadata(type, customerId, producerCode, cropYear);
        var doc = await _docStore.UploadAsync(new DocStoreUpload(FileName(file.FileName, extension), contentType, content, metadata), ct);
        var row = await RecordAsync(doc, contentType, type, customerId, cropYear, null, null, null, ct);
        Audit("AUDIT_UPLOAD", type, doc.Id, customerId);
        return ToResponse(row);
    }

    /// <summary>
    /// Saves a confirmed field's Biofuel Feedstock Report, once per confirmation: the document id goes on the
    /// record's official result, and a second save of the same confirmation returns the first document. A
    /// field unlocked and confirmed again gets a new report; the old one stays in Doc Store.
    /// </summary>
    public async Task<FieldPlanDocumentResponse> SaveReportAsync(int recordId, IFormFile file, CancellationToken ct)
    {
        var record = await _repository.GetRecordAsync(recordId, ct) ?? throw new NotFoundException("Program record", recordId);
        if (record.ProgramKey != FieldPlanPrograms.FdCic || record.Official is null)
            throw new BusinessException("Only a confirmed 45Z field has a Biofuel Feedstock Report.", "FIELD_PLAN_NOT_CONFIRMED");
        var season = record.Season!;
        var field = season.Field!;
        var official = JsonNode.Parse(record.Official)!.AsObject();
        var confirmedAt = official["documentedAt"]?.GetValue<string>() ?? "";

        if (official["reportDocumentId"]?.GetValue<string>() is { Length: > 0 } savedId
            && await _repository.GetDocumentAsync(field.CustomerId, savedId, ct) is { } saved)
            return ToResponse(saved);

        var (content, contentType, extension) = await ReadAsync(file, ct);
        if (contentType != "application/pdf")
            throw new ValidationException("file", "The Biofuel Feedstock Report must be a PDF.");
        var (_, producerCode) = await _repository.GetCustomerCodeAsync(field.CustomerId, ct);
        var crop = await _repository.GetPlantingIntentionCropAsync(season.PlantingIntentionId, ct);
        var commodity = string.IsNullOrWhiteSpace(crop) ? season.CropLabel : crop.Trim();

        var metadata = Metadata(FeedstockReport, field.CustomerId, producerCode, season.CropYear);
        metadata[DocStoreMetadata.SplitId] = field.SplitId;
        metadata[DocStoreMetadata.Commodity] = commodity;
        metadata[DocStoreMetadata.FieldProgramRecordId] = Text(record.Id);
        metadata[DocStoreMetadata.ConfirmedAt] = confirmedAt;
        var doc = await _docStore.UploadAsync(new DocStoreUpload(FileName(file.FileName, extension), contentType, content, metadata), ct);

        official["reportDocumentId"] = doc.Id;
        record.Official = official.ToJsonString(FieldPlanPrograms.Json);
        // One save: the row and the record's reportDocumentId land together.
        var row = await RecordAsync(doc, contentType, FeedstockReport, field.CustomerId, season.CropYear, record.Id, field.SplitId, commodity, ct);
        Audit("AUDIT_SAVE_REPORT", FeedstockReport, doc.Id, field.CustomerId);
        return ToResponse(row);
    }

    public async Task<DocStoreContent> DownloadAsync(long customerId, string documentId, CancellationToken ct)
    {
        // Another producer's document is "not found", not "forbidden": don't confirm that the id exists.
        var row = await _repository.GetDocumentAsync(customerId, documentId ?? "", ct) ?? throw new NotFoundException("Document", documentId ?? "");
        var content = await _docStore.DownloadAsync(row.DocStoreId, ct) ?? throw new NotFoundException("Document", documentId!);
        Audit("AUDIT_DOWNLOAD", row.DocumentType, row.DocStoreId, customerId);
        // Typed and named from the row (decided from the file's bytes on the way in), not from what came back.
        return content with { ContentType = row.ContentType, FileName = row.FileName };
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Writes the document's row. If that fails the file is already in Doc Store with nothing pointing at it,
    /// so its id is logged for clean-up before the error goes on.
    /// </summary>
    private async Task<FieldPlanDocument> RecordAsync(DocStoreDocument doc, string contentType, string type, long customerId, int cropYear,
        int? recordId, string? splitId, string? commodity, CancellationToken ct)
    {
        var row = new FieldPlanDocument
        {
            DocStoreId = doc.Id,
            CustomerId = customerId,
            CropYear = cropYear,
            DocumentType = type,
            FieldProgramRecordId = recordId,
            SplitId = splitId,
            Commodity = commodity is { Length: > 100 } ? commodity[..100] : commodity,
            FileName = doc.FileName,
            ContentType = contentType,
            SizeBytes = doc.Size,
            CreatedAt = doc.UploadedAt,
            CreatedBy = User,
            CreatedByName = _requestContext.GetCurrentUserDisplayName(),
        };
        _repository.Add(row);
        try
        {
            await _repository.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Field plan document row not saved [{ErrorCode}] [{ErrorCategory}]: DocStoreId={Id}, CustomerId={CustomerId}",
                "FIELD_PLAN_DOCUMENT_ORPHANED", "Infrastructure", doc.Id, customerId);
            throw;
        }
        return row;
    }

    private Dictionary<string, string> Metadata(string type, long customerId, string? producerCode, int cropYear)
    {
        var metadata = new Dictionary<string, string>
        {
            [DocStoreMetadata.DocumentType] = type,
            [DocStoreMetadata.CustomerId] = Text(customerId),
            [DocStoreMetadata.CropYear] = Text(cropYear),
            [DocStoreMetadata.UploadedBy] = User,
            [DocStoreMetadata.UploadedByName] = _requestContext.GetCurrentUserDisplayName(),
        };
        if (!string.IsNullOrWhiteSpace(producerCode)) metadata[DocStoreMetadata.ProducerCode] = producerCode.Trim();
        return metadata;
    }

    /// <summary>
    /// Reads the upload and decides its type from its first bytes, never from the name or the browser's
    /// Content-Type: a PDF, PNG or JPEG is kept; anything else is refused.
    /// </summary>
    private async Task<(byte[] Content, string ContentType, string Extension)> ReadAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            throw new ValidationException("file", "Choose a file to upload.");
        if (file.Length > _options.MaxFileBytes)
            throw new ValidationException("file", $"Files can be up to {_options.MaxFileBytes / (1024 * 1024)} MB.");
        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();
        return Sniff(bytes) is { } kind
            ? (bytes, kind.ContentType, kind.Extension)
            : throw new ValidationException("file", "Upload a PDF, PNG or JPEG.");
    }

    internal static (string ContentType, string Extension)? Sniff(ReadOnlySpan<byte> b) =>
        b.StartsWith("%PDF-"u8) ? ("application/pdf", ".pdf")
        : b.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) ? ("image/png", ".png")
        : b.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]) ? ("image/jpeg", ".jpg")
        : null;

    /// <summary>The browser's file name without any path, limited to plain characters, with the extension its contents call for.</summary>
    internal static string FileName(string? name, string extension)
    {
        var stem = Path.GetFileNameWithoutExtension(Path.GetFileName((name ?? "").Replace('\\', '/')));
        var clean = new string(stem.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ' ' ? c : '_').ToArray()).Trim(' ', '.');
        if (clean.Length > 100) clean = clean[..100];
        return (clean.Length == 0 ? "document" : clean) + extension;
    }

    private static void RequireYear(int year)
    {
        if (year is < 2000 or > 2100) throw new ValidationException("cropYear", "Give a crop year between 2000 and 2100.");
    }

    private static string Text(long value) => value.ToString(CultureInfo.InvariantCulture);

    private static FieldPlanDocumentResponse ToResponse(FieldPlanDocument d) => new()
    {
        Id = d.DocStoreId,
        FileName = d.FileName,
        ContentType = d.ContentType,
        Size = d.SizeBytes,
        UploadedAt = DateTime.SpecifyKind(d.CreatedAt, DateTimeKind.Utc),
        UploadedBy = d.CreatedByName ?? d.CreatedBy,
        DocumentType = d.DocumentType,
        CropYear = d.CropYear,
        SplitId = d.SplitId,
        Commodity = d.Commodity,
        FieldProgramRecordId = d.FieldProgramRecordId,
    };

    private void Audit(string code, string documentType, string documentId, long customerId) =>
        _logger.LogInformation(
            "Field plan document {DocumentType} [{ErrorCode}] [{ErrorCategory}]: Id={Id}, CustomerId={CustomerId}, User={User}",
            documentType, code, "DataMutation", documentId, customerId, User);
}
