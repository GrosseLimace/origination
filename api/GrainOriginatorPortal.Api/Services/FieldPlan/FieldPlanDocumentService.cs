using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.DocStore;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Options;

namespace GrainOriginatorPortal.Api.Services.FieldPlan;

/// <summary>
/// A producer's 45Z documents in Doc Store (category Sustainability-45z): the Biofuel Feedstock Report (PDF) and
/// the Mass Balance Ledger (CSV) saved for a field and year when its CI is confirmed, and what the originator
/// uploads for the producer and crop year (the signed annual attestation, other supporting documents). The
/// server sets every metadata value from its own rows; a request only supplies the file, and for an upload the
/// year and type. Each document gets a dbo.FieldPlanDocument row, which is what the dialog lists and what a
/// download is checked against: a document id from another producer is a 404.
/// <para>Nothing is deleted or replaced in Doc Store. Confirming a field again marks its previous report and
/// ledger Overwritten; an originator can mark any document Archived and restore it. Both kinds stay listed
/// as the document's version history.</para>
/// </summary>
public interface IFieldPlanDocumentService
{
    Task<IReadOnlyList<FieldPlanDocumentResponse>> ListAsync(long customerId, int? cropYear, CancellationToken ct);
    Task<FieldPlanDocumentResponse> UploadAsync(long customerId, int cropYear, string documentType, IFormFile file, CancellationToken ct);
    Task<FieldPlanDocumentResponse> SaveReportAsync(int recordId, IFormFile file, CancellationToken ct);
    Task<FieldPlanDocumentResponse> SaveLedgerAsync(int recordId, IFormFile file, CancellationToken ct);
    Task<FieldPlanDocumentResponse> ArchiveAsync(long customerId, string documentId, string? note, CancellationToken ct);
    Task<FieldPlanDocumentResponse> RestoreAsync(long customerId, string documentId, CancellationToken ct);
    Task<DocStoreContent> DownloadAsync(long customerId, string documentId, CancellationToken ct);
}

/// <inheritdoc />
public sealed class FieldPlanDocumentService : IFieldPlanDocumentService
{
    public const string FeedstockReport = "FeedstockReport";
    public const string MassBalanceLedger = "MassBalanceLedger";
    public const string ProducerAttestation = "ProducerAttestation";
    public const string Other = "Other";
    /// <summary>What an originator may upload; the report and ledger are only ever saved by confirming a field.</summary>
    private static readonly string[] Uploadable = [ProducerAttestation, Other];

    /// <summary>
    /// The Mass Balance Ledger's header row, as the client writes it (mass-balance-ledger.ts LEDGER_HEADERS). A
    /// ledger upload must start with it, so only that file can be filed as a ledger.
    /// </summary>
    internal const string LedgerHeader = "Producer code,Producer name,Split ID,Field,Enrollment ID,Crop year,Commodity,Acres," +
        "Confirmed bushels,Tickets,CI (g CO2e/bu),Tillage,USDA version,Confirmed by,Confirmed at";

    /// <summary>What a confirmation saves: the document type, the key its id is kept under on the official result, and its name.</summary>
    private sealed record ConfirmationDocument(string Type, string OfficialKey, string Label);
    private static readonly ConfirmationDocument Report = new(FeedstockReport, "reportDocumentId", "Biofuel Feedstock Report");
    private static readonly ConfirmationDocument Ledger = new(MassBalanceLedger, "ledgerDocumentId", "Mass Balance Ledger");

    private const int MaxNoteLength = 500;

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
        // A producer has one current attestation a year: a new one archives the one it replaces (decision B. Cozart, 2026-11-05).
        var replaced = type == ProducerAttestation ? await CurrentAttestationsAsync(customerId, cropYear, ct) : [];

        var metadata = Metadata(type, customerId, producerCode, cropYear);
        var doc = await _docStore.UploadAsync(new DocStoreUpload(FileName(file.FileName, extension), contentType, content, metadata), ct);
        foreach (var old in replaced)
        {
            SetStatus(old, FieldPlanDocument.Archived, AttestationReplacedNote);
            old.ReplacedByDocStoreId = doc.Id;
        }
        // One save: the new row and the previous attestation's Archived land together.
        var row = await RecordAsync(doc, contentType, type, customerId, cropYear, null, null, null, null, ct);
        Audit("AUDIT_UPLOAD", type, doc.Id, customerId);
        foreach (var old in replaced) Audit("AUDIT_ARCHIVE", old.DocumentType, old.DocStoreId, customerId);
        return ToResponse(row);
    }

    /// <summary>The archive reason on an attestation replaced by a newer upload.</summary>
    internal const string AttestationReplacedNote = "Replaced by a newer producer attestation.";

    /// <summary>The producer's current attestations for the year (tracked, so a status change is saved with the next save).</summary>
    private async Task<List<FieldPlanDocument>> CurrentAttestationsAsync(long customerId, int cropYear, CancellationToken ct) =>
        (await _repository.GetDocumentsAsync(customerId, cropYear, ct))
            .Where(d => d.DocumentType == ProducerAttestation && d.Status == FieldPlanDocument.Current).ToList();

    /// <summary>Saves a confirmed field's Biofuel Feedstock Report (PDF). See <see cref="SaveConfirmationAsync"/>.</summary>
    public Task<FieldPlanDocumentResponse> SaveReportAsync(int recordId, IFormFile file, CancellationToken ct) =>
        SaveConfirmationAsync(recordId, Report, file, ct);

    /// <summary>Saves a confirmed field's Mass Balance Ledger (CSV). See <see cref="SaveConfirmationAsync"/>.</summary>
    public Task<FieldPlanDocumentResponse> SaveLedgerAsync(int recordId, IFormFile file, CancellationToken ct) =>
        SaveConfirmationAsync(recordId, Ledger, file, ct);

    /// <summary>
    /// Saves a confirmed field's report or ledger, once per confirmation: the document id goes on the record's
    /// official result, and a second save of the same confirmation returns the first document. A field unlocked
    /// and confirmed again gets a new one, and the field's previous current one is marked Overwritten (the file
    /// stays in Doc Store and in the version history).
    /// </summary>
    private async Task<FieldPlanDocumentResponse> SaveConfirmationAsync(int recordId, ConfirmationDocument kind, IFormFile file, CancellationToken ct)
    {
        var record = await _repository.GetRecordAsync(recordId, ct) ?? throw new NotFoundException("Program record", recordId);
        if (record.ProgramKey != FieldPlanPrograms.FdCic || record.Official is null)
            throw new BusinessException($"Only a confirmed 45Z field has a {kind.Label}.", "FIELD_PLAN_NOT_CONFIRMED");
        var season = record.Season!;
        var field = season.Field!;
        var official = JsonNode.Parse(record.Official)!.AsObject();
        var confirmedAt = official["documentedAt"]?.GetValue<string>() ?? "";

        if (official[kind.OfficialKey]?.GetValue<string>() is { Length: > 0 } savedId
            && await _repository.GetDocumentAsync(field.CustomerId, savedId, ct) is { } saved)
            return ToResponse(saved);

        var (content, contentType, extension) = kind == Ledger ? await ReadLedgerAsync(file, ct) : await ReadAsync(file, ct);
        if (kind == Report && contentType != "application/pdf")
            throw new ValidationException("file", "The Biofuel Feedstock Report must be a PDF.");
        var (_, producerCode) = await _repository.GetCustomerCodeAsync(field.CustomerId, ct);
        var crop = await _repository.GetPlantingIntentionCropAsync(season.PlantingIntentionId, ct);
        var commodity = string.IsNullOrWhiteSpace(crop) ? season.CropLabel : crop.Trim();
        var previous = await _repository.GetCurrentRecordDocumentsAsync(record.Id, kind.Type, ct);

        var metadata = Metadata(kind.Type, field.CustomerId, producerCode, season.CropYear);
        metadata[DocStoreMetadata.SplitId] = field.SplitId;
        metadata[DocStoreMetadata.FieldName] = field.Name;
        metadata[DocStoreMetadata.Commodity] = commodity;
        metadata[DocStoreMetadata.FieldProgramRecordId] = Text(record.Id);
        metadata[DocStoreMetadata.ConfirmedAt] = confirmedAt;
        var doc = await _docStore.UploadAsync(new DocStoreUpload(FileName(file.FileName, extension), contentType, content, metadata), ct);

        official[kind.OfficialKey] = doc.Id;
        record.Official = official.ToJsonString(FieldPlanPrograms.Json);
        foreach (var old in previous)
        {
            SetStatus(old, FieldPlanDocument.Overwritten, null);
            old.ReplacedByDocStoreId = doc.Id;
        }
        // One save: the new row, the record's document id and the previous one's Overwritten land together.
        var row = await RecordAsync(doc, contentType, kind.Type, field.CustomerId, season.CropYear, record.Id, field.SplitId, field.Name, commodity, ct);
        Audit(kind == Ledger ? "AUDIT_SAVE_LEDGER" : "AUDIT_SAVE_REPORT", kind.Type, doc.Id, field.CustomerId);
        foreach (var old in previous) Audit("AUDIT_OVERWRITE", old.DocumentType, old.DocStoreId, field.CustomerId);
        return ToResponse(row);
    }

    /// <summary>Sets a current document aside (e.g. no longer relevant to the year). It stays in the version history and can be restored.</summary>
    public async Task<FieldPlanDocumentResponse> ArchiveAsync(long customerId, string documentId, string? note, CancellationToken ct)
    {
        var row = await FindAsync(customerId, documentId, ct);
        if (row.Status != FieldPlanDocument.Current)
            throw new BusinessException("Only a current document can be archived.", "FIELD_PLAN_DOCUMENT_NOT_CURRENT");
        var reason = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (reason is { Length: > MaxNoteLength })
            throw new ValidationException("note", $"Keep the reason to {MaxNoteLength} characters.");
        SetStatus(row, FieldPlanDocument.Archived, reason);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_ARCHIVE", row.DocumentType, row.DocStoreId, customerId);
        return ToResponse(row);
    }

    /// <summary>
    /// Brings an archived document back to current. A field's report or ledger can't be restored over a newer
    /// current one: that one would have to be archived first, so a field never has two current reports.
    /// </summary>
    public async Task<FieldPlanDocumentResponse> RestoreAsync(long customerId, string documentId, CancellationToken ct)
    {
        var row = await FindAsync(customerId, documentId, ct);
        if (row.Status != FieldPlanDocument.Archived)
            throw new BusinessException("Only an archived document can be restored.", "FIELD_PLAN_DOCUMENT_NOT_ARCHIVED");
        if (row.FieldProgramRecordId is { } recordId && (await _repository.GetCurrentRecordDocumentsAsync(recordId, row.DocumentType, ct)).Count > 0)
            throw new BusinessException(
                $"This field has a newer {(row.DocumentType == MassBalanceLedger ? Ledger.Label : Report.Label)}. Archive that one first to restore this one.",
                "FIELD_PLAN_DOCUMENT_HAS_NEWER");
        if (row.DocumentType == ProducerAttestation && (await CurrentAttestationsAsync(customerId, row.CropYear, ct)).Count > 0)
            throw new BusinessException(
                $"{row.CropYear} has a newer producer attestation. Archive that one first to restore this one.",
                "FIELD_PLAN_DOCUMENT_HAS_NEWER");
        SetStatus(row, FieldPlanDocument.Current, null);
        row.ReplacedByDocStoreId = null;
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_RESTORE", row.DocumentType, row.DocStoreId, customerId);
        return ToResponse(row);
    }

    public async Task<DocStoreContent> DownloadAsync(long customerId, string documentId, CancellationToken ct)
    {
        var row = await FindAsync(customerId, documentId, ct);
        var content = await _docStore.DownloadAsync(row.DocStoreId, ct) ?? throw new NotFoundException("Document", documentId!);
        Audit("AUDIT_DOWNLOAD", row.DocumentType, row.DocStoreId, customerId);
        // Typed and named from the row (decided from the file's bytes on the way in), not from what came back.
        return content with { ContentType = row.ContentType, FileName = row.FileName };
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /// <summary>The producer's document; another producer's is "not found", not "forbidden", so the id isn't confirmed to exist.</summary>
    private async Task<FieldPlanDocument> FindAsync(long customerId, string? documentId, CancellationToken ct) =>
        await _repository.GetDocumentAsync(customerId, documentId ?? "", ct) ?? throw new NotFoundException("Document", documentId ?? "");

    private void SetStatus(FieldPlanDocument row, string status, string? note)
    {
        row.Status = status;
        row.StatusChangedAt = DateTime.UtcNow;
        row.StatusChangedBy = User;
        row.StatusChangedByName = _requestContext.GetCurrentUserDisplayName();
        row.StatusNote = note;
    }

    /// <summary>
    /// Writes the document's row. If that fails the file is already in Doc Store with nothing pointing at it,
    /// so its id is logged for clean-up before the error goes on.
    /// </summary>
    private async Task<FieldPlanDocument> RecordAsync(DocStoreDocument doc, string contentType, string type, long customerId, int cropYear,
        int? recordId, string? splitId, string? fieldName, string? commodity, CancellationToken ct)
    {
        var row = new FieldPlanDocument
        {
            DocStoreId = doc.Id,
            CustomerId = customerId,
            CropYear = cropYear,
            DocumentType = type,
            FieldProgramRecordId = recordId,
            SplitId = splitId,
            FieldName = fieldName is { Length: > 255 } ? fieldName[..255] : fieldName,
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

    /// <summary>
    /// Reads a Mass Balance Ledger: UTF-8 text (a byte-order mark is kept, so Excel reads it as UTF-8) whose first
    /// line is <see cref="LedgerHeader"/> and which has at least one row. Anything else is refused.
    /// </summary>
    private async Task<(byte[] Content, string ContentType, string Extension)> ReadLedgerAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            throw new ValidationException("file", "Choose a file to upload.");
        if (file.Length > _options.MaxFileBytes)
            throw new ValidationException("file", $"Files can be up to {_options.MaxFileBytes / (1024 * 1024)} MB.");
        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();
        return IsLedger(bytes) ? (bytes, "text/csv", ".csv")
            : throw new ValidationException("file", "That isn't a Mass Balance Ledger file.");
    }

    internal static bool IsLedger(byte[] bytes)
    {
        string text;
        try
        {
            text = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
        if (text.Contains('\0')) return false;
        var lines = text.TrimStart((char)0xFEFF).Split(["\r\n", "\n"], StringSplitOptions.None);
        return lines.Length > 1 && lines[0] == LedgerHeader && lines.Skip(1).Any(l => l.Length > 0) && !HasFormula(text);
    }

    /// <summary>
    /// Whether any cell would run as a spreadsheet formula (CWE-1236): text starting with = + @ or a tab, or a - that
    /// doesn't start a number. The client's csvCell guards these with a leading apostrophe, so its ledger never has one.
    /// </summary>
    internal static bool HasFormula(string csv)
    {
        var cellStart = true;
        var quoted = false;
        for (var i = 0; i < csv.Length; i++)
        {
            var c = csv[i];
            if (cellStart)
            {
                cellStart = false;
                if (c == '"') { quoted = true; if (i + 1 < csv.Length && Starts(csv, i + 1)) return true; continue; }
                if (Starts(csv, i)) return true;
            }
            if (quoted)
            {
                if (c == '"' && i + 1 < csv.Length && csv[i + 1] == '"') i++;
                else if (c == '"') quoted = false;
            }
            else if (c is ',' or '\n' or '\r') cellStart = true;
        }
        return false;

        static bool Starts(string s, int at) =>
            s[at] is '=' or '+' or '@' or '\t' || (s[at] == '-' && !(at + 1 < s.Length && (char.IsAsciiDigit(s[at + 1]) || s[at + 1] == '.')));
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
        FieldName = d.FieldName,
        Commodity = d.Commodity,
        FieldProgramRecordId = d.FieldProgramRecordId,
        Status = d.Status,
        StatusChangedAt = d.StatusChangedAt is { } at ? DateTime.SpecifyKind(at, DateTimeKind.Utc) : null,
        StatusChangedBy = d.StatusChangedByName ?? d.StatusChangedBy,
        StatusNote = d.StatusNote,
        ReplacedById = d.ReplacedByDocStoreId,
    };

    private void Audit(string code, string documentType, string documentId, long customerId) =>
        _logger.LogInformation(
            "Field plan document {DocumentType} [{ErrorCode}] [{ErrorCategory}]: Id={Id}, CustomerId={CustomerId}, User={User}",
            documentType, code, "DataMutation", documentId, customerId, User);
}
