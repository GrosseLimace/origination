using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Ctrm;
using GrainOriginatorPortal.Api.Services.FdCic;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services.FieldPlan;

/// <summary>
/// The field plan: a producer's fields (CTRM splits), their seasons on crop rows, each season's program
/// records, and the producer's program enrollments. Mirrors the client's FieldPlanBackend contract, one
/// method per call, and owns the rules that must hold across users (see
/// docs/application-context/Field Plan - Database Plan.md, "Rules the server enforces").
/// </summary>
public interface IFieldPlanService
{
    Task<FieldPlanSnapshotResponse> LoadAsync(long customerId, CancellationToken ct);
    Task<ProducerFieldResponse> CreateFieldAsync(CreateProducerFieldRequest request, CancellationToken ct);
    Task<ProducerFieldResponse> UpdateFieldAsync(string splitId, UpdateProducerFieldRequest request, CancellationToken ct);
    Task<FieldSeasonResponse> AddSeasonAsync(CreateFieldSeasonRequest request, CancellationToken ct);
    Task<FieldSeasonResponse> UpdateSeasonAsync(int seasonId, UpdateFieldSeasonRequest request, CancellationToken ct);
    Task RemoveSeasonAsync(int seasonId, CancellationToken ct);
    Task<FieldProgramRecordResponse> AddRecordAsync(CreateFieldProgramRecordRequest request, CancellationToken ct);
    Task<FieldProgramRecordResponse> UpdateRecordAsync(int recordId, UpdateFieldProgramRecordRequest request, CancellationToken ct);
    Task RemoveRecordAsync(int recordId, CancellationToken ct);
    Task<FieldProgramRecordResponse> ReopenAsync(int recordId, string reason, CancellationToken ct);
    Task<FieldProgramRecordResponse> ConfirmAsync(int recordId, ConfirmFieldProgramRecordRequest request, CancellationToken ct);
    Task<ProgramEnrollmentResponse?> EnsureEnrollmentAsync(EnsureProgramEnrollmentRequest request, CancellationToken ct);
    Task<ProgramEnrollmentResponse> UpdateAttestationAsync(Guid key, ProgramAttestationDto attestation, CancellationToken ct);
    Task<ProgramEnrollmentResponse> AttestAsync(Guid key, IReadOnlyList<JsonElement> listed, CancellationToken ct);
    Task<ProgramEnrollmentResponse> WithdrawAsync(Guid key, string reason, CancellationToken ct);
}

/// <inheritdoc />
public sealed class FieldPlanService : IFieldPlanService
{
    private const string Draft = "Draft", Locked = "Locked";
    private const string Open = "Open", Attested = "Attested", Withdrawn = "Withdrawn";

    private readonly IFieldPlanRepository _repository;
    private readonly IProducerSplitService _splits;
    private readonly IFdCicService _fdCic;
    private readonly IFieldTicketService _tickets;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<FieldPlanService> _logger;
    private readonly TimeProvider _clock;

    public FieldPlanService(IFieldPlanRepository repository, IProducerSplitService splits, IFdCicService fdCic, IFieldTicketService tickets,
        IRequestContextService requestContext, ILogger<FieldPlanService> logger, TimeProvider? clock = null)
    {
        _repository = repository;
        _splits = splits;
        _fdCic = fdCic;
        _tickets = tickets;
        _requestContext = requestContext;
        _logger = logger;
        _clock = clock ?? TimeProvider.System;
    }

    private DateTime Now => _clock.GetUtcNow().UtcDateTime;
    private string User => _requestContext.GetCurrentUser();

    public async Task<FieldPlanSnapshotResponse> LoadAsync(long customerId, CancellationToken ct)
    {
        var rows = await _repository.LoadAsync(customerId, ct);
        var splitOf = rows.Fields.ToDictionary(f => f.Id, f => f.SplitId);
        return new FieldPlanSnapshotResponse
        {
            Fields = rows.Fields.Select(ToResponse).ToList(),
            Seasons = rows.Seasons.Select(s => ToResponse(s, splitOf[s.ProducerFieldId])).ToList(),
            Records = rows.Records.Select(ToResponse).ToList(),
            Enrollments = rows.Enrollments.Select(ToResponse).ToList(),
        };
    }

    // ── Fields and seasons ───────────────────────────────────────────────────

    /// <summary>
    /// A field is one of the producer's splits; a split another producer already holds is refused. With CTRM's
    /// splits query its name, split % and effective date come from CTRM, never the request. SPLITS-GRAPHQL: until
    /// that query is live (any other <c>Ctrm:SplitsSource</c>) the originator types them, and the field is marked Manual.
    /// </summary>
    public async Task<ProducerFieldResponse> CreateFieldAsync(CreateProducerFieldRequest request, CancellationToken ct)
    {
        var splitId = request.SplitId.Trim().ToUpperInvariant();
        if (!IsSplitCode(splitId))
            throw new ValidationException("splitId", "A split ID is 1 to 7 letters or digits, as in CTRM (e.g. TATOB43).");
        var existing = await _repository.GetFieldAsync(splitId, ct);
        if (existing is not null && existing.CustomerId != request.CustomerId)
            throw new BusinessException($"Split {splitId} is another producer's field.", "FIELD_PLAN_SPLIT_TAKEN");
        if (existing is not null) return ToResponse(existing);

        var field = new ProducerField
        {
            CustomerId = request.CustomerId,
            SplitId = splitId,
            State = Clean(request.State)?.ToUpperInvariant(),
            County = Clean(request.County),
            CreatedAt = Now,
            CreatedBy = User,
        };
        if (_splits.Source == "ctrm")
        {
            var splits = await _splits.GetByCustomerAsync(request.CustomerId, ct);
            var split = splits.Splits.FirstOrDefault(s => string.Equals(s.SplitId, splitId, StringComparison.OrdinalIgnoreCase))
                ?? throw new BusinessException($"{splitId} isn't one of this producer's CTRM splits.", "FIELD_PLAN_UNKNOWN_SPLIT", StatusCodes.Status422UnprocessableEntity);
            if (split.Expired || split.Kind != "Field")
                throw new BusinessException($"{splitId} is {(split.Expired ? "expired" : "a bin site, not a field")} in CTRM.", "FIELD_PLAN_SPLIT_NOT_A_FIELD", StatusCodes.Status422UnprocessableEntity);
            field.Name = split.FieldName;
            field.SplitPercent = split.SplitPercent;
            field.EffectiveDate = DateOnly.TryParseExact(split.EffectiveDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
            field.SplitSource = "Ctrm";
        }
        else
        {
            // SPLITS-GRAPHQL: typed by the originator. Sample splits (local demos) are treated the same way.
            if (!await _repository.CustomerExistsAsync(request.CustomerId, ct))
                throw new NotFoundException("Producer", request.CustomerId);
            field.Name = Clean(request.Name) ?? splitId;
            field.SplitPercent = request.SplitPercent ?? 100m;
            field.EffectiveDate = request.EffectiveDate;
            field.SplitSource = "Manual";
        }
        _repository.Add(field);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_CREATE", "ProducerField", splitId, field.CustomerId);
        return ToResponse(field);
    }

    /// <summary>The location; and for a split typed by hand, its name and share. A CTRM split's are CTRM's. The split ID never changes.</summary>
    public async Task<ProducerFieldResponse> UpdateFieldAsync(string splitId, UpdateProducerFieldRequest request, CancellationToken ct)
    {
        var field = await _repository.GetFieldAsync(splitId.Trim().ToUpperInvariant(), ct)
            ?? throw new NotFoundException("Field", splitId);
        field.State = Clean(request.State)?.ToUpperInvariant();
        field.County = Clean(request.County);
        if (field.SplitSource == "Manual")
        {
            if (Clean(request.Name) is { } name) field.Name = name;
            if (request.SplitPercent is { } pct) field.SplitPercent = pct;
        }
        Touch(field);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_UPDATE", "ProducerField", field.SplitId, field.CustomerId);
        return ToResponse(field);
    }

    public async Task<FieldSeasonResponse> AddSeasonAsync(CreateFieldSeasonRequest request, CancellationToken ct)
    {
        var field = await _repository.GetFieldAsync(request.FieldKey.Trim().ToUpperInvariant(), ct)
            ?? throw new NotFoundException("Field", request.FieldKey);
        if (!await _repository.PlantingIntentionMatchesAsync(request.PlantingIntentionId, field.CustomerId, request.Year, ct))
            throw new ValidationException("plantingIntentionId", "That crop row isn't this producer's for that year.");
        // One field grows a crop once a year: a second row of the same crop would claim its tickets twice.
        // The crop is the row's commodity code first, as the ticket lookup reads it, then its label.
        var group = await CropGroupAsync(request.PlantingIntentionId, request.CropLabel, ct);
        ProducerFieldSeason? sameCrop = null;
        foreach (var s in await _repository.GetSeasonsForFieldAsync(field.Id, request.Year, ct))
            if (s.PlantingIntentionId == request.PlantingIntentionId
                || (group is not null && await CropGroupAsync(s.PlantingIntentionId, s.CropLabel, ct) == group))
            {
                sameCrop = s;
                break;
            }
        if (sameCrop is not null)
            throw new BusinessException($"{field.Name} is already on the {sameCrop.CropLabel} row for {request.Year}.", "FIELD_PLAN_FIELD_ON_ROW", StatusCodes.Status409Conflict);

        var season = new ProducerFieldSeason
        {
            ProducerFieldId = field.Id,
            PlantingIntentionId = request.PlantingIntentionId,
            CropYear = request.Year,
            CropLabel = request.CropLabel.Trim(),
            Acres = request.Acres,
            CreatedAt = Now,
            CreatedBy = User,
        };
        _repository.Add(season);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_CREATE", "ProducerFieldSeason", season.Id, field.CustomerId);
        return ToResponse(season, field.SplitId);
    }

    public async Task<FieldSeasonResponse> UpdateSeasonAsync(int seasonId, UpdateFieldSeasonRequest request, CancellationToken ct)
    {
        var season = await RequireSeasonAsync(seasonId, ct);
        var records = await _repository.GetRecordsForSeasonAsync(seasonId, ct);
        if (records.Any(r => r.Status == Locked))
            throw new BusinessException("This field's CI is confirmed, so its acres can't change.", "FIELD_PLAN_LOCKED");
        season.Acres = request.Acres;
        Touch(season);
        // Acres decide whether a 45Z record is complete, so its Draft/Ready follows them.
        foreach (var r in records) r.Status = StatusFor(r, season);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_UPDATE", "ProducerFieldSeason", seasonId, season.Field!.CustomerId);
        return ToResponse(season, season.Field.SplitId);
    }

    /// <summary>Takes a field off a crop row, with its unlocked program records (soft delete).</summary>
    public async Task RemoveSeasonAsync(int seasonId, CancellationToken ct)
    {
        var season = await RequireSeasonAsync(seasonId, ct);
        var records = await _repository.GetRecordsForSeasonAsync(seasonId, ct);
        if (records.Any(r => r.Status == Locked))
            throw new BusinessException("This field's CI is confirmed, so it can't come off the crop row.", "FIELD_PLAN_LOCKED");
        foreach (var r in records) SoftDelete(r);
        SoftDelete(season);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_DELETE", "ProducerFieldSeason", seasonId, season.Field!.CustomerId);
    }

    // ── Program records ─────────────────────────────────────────────────────

    /// <summary>Adds a program to a field season; returns the existing record if it's already there.</summary>
    public async Task<FieldProgramRecordResponse> AddRecordAsync(CreateFieldProgramRecordRequest request, CancellationToken ct)
    {
        var season = await RequireSeasonAsync(ParseId(request.SeasonId, "seasonId"), ct);
        if (!FieldPlanPrograms.IsKnown(request.ProgramKey))
            throw new ValidationException("programKey", $"Unknown program {request.ProgramKey}.");
        if (!FieldPlanPrograms.AppliesTo(request.ProgramKey, season.CropLabel))
            throw new ValidationException("programKey", $"That program doesn't apply to {season.CropLabel}.");
        var existing = await _repository.GetRecordAsync(season.Id, request.ProgramKey, ct);
        if (existing is not null) return ToResponse(existing);

        FieldPlanPrograms.ValidateData(request.ProgramKey, request.Data);
        var record = new FieldProgramRecord
        {
            ProducerFieldSeasonId = season.Id,
            ProgramKey = request.ProgramKey,
            Data = request.Data.GetRawText(),
            Status = FieldPlanPrograms.StatusFor(request.ProgramKey, request.Data, season),
            CopiedFromYear = request.CopiedFromYear,
            CreatedAt = Now,
            CreatedBy = User,
        };
        _repository.Add(record);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_CREATE", "FieldProgramRecord", record.Id, season.Field!.CustomerId);
        return ToResponse(record);
    }

    /// <summary>Saves a record's inputs. Refused once it's locked; Draft/Ready is worked out here.</summary>
    public async Task<FieldProgramRecordResponse> UpdateRecordAsync(int recordId, UpdateFieldProgramRecordRequest request, CancellationToken ct)
    {
        var record = await RequireRecordAsync(recordId, ct);
        if (record.Status == Locked)
            throw new BusinessException("This field's CI is confirmed; unlock it to make changes.", "FIELD_PLAN_LOCKED");
        FieldPlanPrograms.ValidateData(record.ProgramKey, request.Data);
        record.Data = request.Data.GetRawText();
        record.Status = FieldPlanPrograms.StatusFor(record.ProgramKey, request.Data, record.Season!);
        if (Clean(request.CopiedFromField) is { } from) record.CopiedFromField = from;
        Touch(record);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_UPDATE", "FieldProgramRecord", recordId, record.Season!.Field!.CustomerId);
        return ToResponse(record);
    }

    /// <summary>Takes a program off a field. A locked record is kept (quietly), as the client expects.</summary>
    public async Task RemoveRecordAsync(int recordId, CancellationToken ct)
    {
        var record = await _repository.GetRecordAsync(recordId, ct);
        if (record is null || record.Status == Locked) return;
        SoftDelete(record);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_DELETE", "FieldProgramRecord", recordId, record.Season!.Field!.CustomerId);
    }

    /// <summary>
    /// Unlocks a confirmed CI with a reason, keeping it and its frozen estimate in the record's history.
    /// Refused while an attested enrollment holds the record.
    /// </summary>
    public async Task<FieldProgramRecordResponse> ReopenAsync(int recordId, string reason, CancellationToken ct)
    {
        var record = await RequireRecordAsync(recordId, ct);
        if (record.Status != Locked || record.Frozen is null)
            throw new BusinessException("Only a confirmed CI can be unlocked.", "FIELD_PLAN_NOT_LOCKED");
        if (string.IsNullOrWhiteSpace(reason))
            throw new ValidationException("reason", "Give a reason for reopening.");
        var season = record.Season!;
        var customerId = season.Field!.CustomerId;
        var live = await _repository.GetLiveEnrollmentAsync(customerId, record.ProgramKey, season.CropYear, ct);
        if (live is { Status: Attested } && SnapshotRecordIds(live.Snapshot).Contains(record.Id.ToString(CultureInfo.InvariantCulture)))
            throw new BusinessException("The producer's attested enrollment holds this record, so it can't be reopened.", "FIELD_PLAN_HELD");

        // A confirmed CI is unlocked with its estimate: both go to the history, and the field can be reviewed again.
        KeepInHistory(record, reason.Trim());
        record.Frozen = null;
        record.Official = null;
        record.LockedBy = null;
        record.LockedAt = null;
        record.Status = StatusFor(record, season);
        Touch(record);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_REOPEN", "FieldProgramRecord", recordId, customerId);
        return ToResponse(record);
    }

    /// <summary>
    /// Confirms a 45Z field after harvest, once the originator has gone over its inputs and CTRM tickets with
    /// the producer. The tickets are read again here and only the listed keys are kept, so the bushels are
    /// CTRM's, never the request's. The actual yield is set, the CI is rescored with the server's calculator
    /// and the record locked, and the confirmed CI with its
    /// bushels and tickets becomes the record's official result: what the Bins' CSV is built from.
    /// Allowed while an attested enrollment holds the record: attesting comes before harvest, confirming after.
    /// </summary>
    public async Task<FieldProgramRecordResponse> ConfirmAsync(int recordId, ConfirmFieldProgramRecordRequest request, CancellationToken ct)
    {
        var record = await RequireRecordAsync(recordId, ct);
        if (record.ProgramKey != FieldPlanPrograms.FdCic)
            throw new BusinessException("Only a 45Z field is confirmed with its tickets.", "FIELD_PLAN_NOT_CONFIRMABLE");
        // Locked without an official result is a row from the removed harvest lock: unlocking keeps its estimate.
        if (record.Official is not null || record.Status == Locked)
            throw new BusinessException("This field's CI is already confirmed; unlock it to review it again.", "FIELD_PLAN_ALREADY_CONFIRMED");
        if (!request.ReviewedWithProducer)
            throw new ValidationException("reviewedWithProducer", "Confirm that the inputs and tickets were reviewed with the producer after harvest.");
        var keys = request.TicketKeys.Select(k => k.Trim()).Where(k => k.Length > 0).ToHashSet(StringComparer.Ordinal);
        if (keys.Count == 0)
            throw new ValidationException("ticketKeys", "Include at least one ticket.");

        var season = record.Season!;
        var field = season.Field!;
        var found = await _tickets.ForRecordAsync(record, ct);
        // The crop year's tickets, plus any of the split's other tickets for the crop the originator added.
        var included = found.Tickets.Where(t => keys.Contains(t.TicketKey))
            .Concat(found.Others.Where(t => keys.Contains(t.TicketKey)).Select(t => t with { CropYearMatch = "added" }))
            .ToList();
        if (included.Count != keys.Count)
            throw new BusinessException("Some of those tickets are no longer this field's in CTRM; reopen the review and try again.", "FIELD_PLAN_STALE_TICKETS");
        if (included.FirstOrDefault(t => t.ConfirmedFor is not null) is { } counted)
            throw new BusinessException($"Ticket {counted.TicketNumber} is already counted in this field's {counted.ConfirmedFor} confirmed CI; leave it out.",
                "FIELD_PLAN_TICKET_ALREADY_COUNTED", StatusCodes.Status409Conflict);
        if (included.FirstOrDefault(t => t.NetBushels is null) is { } unconverted)
            throw new BusinessException($"Ticket {unconverted.TicketNumber} has no bushel figure, so it can't be counted; leave it out or ask for its product's conversion.",
                "FIELD_PLAN_TICKET_NO_BUSHELS", StatusCodes.Status422UnprocessableEntity);

        var data = JsonNode.Parse(record.Data)!.AsObject();
        data["actualYield"] = request.ActualYield;
        record.Data = data.ToJsonString(FieldPlanPrograms.Json);

        var now = Now;
        record.Frozen = FieldPlanPrograms.Freeze(record, season, field, _fdCic, User, now);
        var frozen = JsonNode.Parse(record.Frozen)!;
        record.Official = new JsonObject
        {
            ["status"] = "Documented",
            ["score"] = frozen["score"]!.DeepClone(),
            ["method"] = frozen["calculatorVersion"]!.DeepClone(),
            ["actualYield"] = request.ActualYield,
            ["bushels"] = included.Sum(t => t.NetBushels!.Value),
            ["tickets"] = JsonSerializer.SerializeToNode(included, FieldPlanPrograms.Json),
            ["documentedBy"] = User,
            ["documentedAt"] = now.ToString("o"),
        }.ToJsonString(FieldPlanPrograms.Json);
        record.Status = Locked;
        record.LockedBy = User;
        record.LockedAt = now;
        Touch(record);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_CONFIRM", "FieldProgramRecord", recordId, field.CustomerId);
        return ToResponse(record);
    }

    /// <summary>Adds the record's current locked estimate (and confirmed CI, if any) to its history with a reason.</summary>
    private void KeepInHistory(FieldProgramRecord record, string reason)
    {
        var history = record.Reopened is null ? new JsonArray() : JsonNode.Parse(record.Reopened)!.AsArray();
        var entry = new JsonObject { ["reason"] = reason, ["at"] = Now.ToString("o"), ["frozen"] = JsonNode.Parse(record.Frozen!) };
        if (record.Official is not null) entry["official"] = JsonNode.Parse(record.Official);
        history.Add(entry);
        record.Reopened = history.ToJsonString(FieldPlanPrograms.Json);
    }

    // ── Enrollments ─────────────────────────────────────────────────────────

    /// <summary>The producer's live enrollment, created if there isn't one; null for a program without enrollment.</summary>
    public async Task<ProgramEnrollmentResponse?> EnsureEnrollmentAsync(EnsureProgramEnrollmentRequest request, CancellationToken ct)
    {
        if (!FieldPlanPrograms.IsKnown(request.ProgramKey))
            throw new ValidationException("programKey", $"Unknown program {request.ProgramKey}.");
        var existing = await _repository.GetLiveEnrollmentAsync(request.CustomerId, request.ProgramKey, request.Year, ct);
        if (existing is not null) return ToResponse(existing);
        if (!FieldPlanPrograms.HasEnrollment(request.ProgramKey)) return null;

        var blank = new ProgramAttestationDto
        {
            SignerName = "", SignedOn = "", Method = "eSign", DocumentRef = "",
            Confirmations = FieldPlanPrograms.StatementsFor(request.ProgramKey).ToDictionary(s => s.Key, _ => false),
        };
        var enrollment = new ProgramEnrollment
        {
            EnrollmentKey = Guid.NewGuid(),
            CustomerId = request.CustomerId,
            ProgramKey = request.ProgramKey,
            CropYear = request.Year,
            Status = Open,
            Attestation = JsonSerializer.Serialize(blank, FieldPlanPrograms.Json),
            CreatedAt = Now,
            CreatedBy = User,
        };
        _repository.Add(enrollment);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_CREATE", "ProgramEnrollment", enrollment.EnrollmentKey, enrollment.CustomerId);
        return ToResponse(enrollment);
    }

    public async Task<ProgramEnrollmentResponse> UpdateAttestationAsync(Guid key, ProgramAttestationDto attestation, CancellationToken ct)
    {
        var enrollment = await RequireEnrollmentAsync(key, ct);
        if (enrollment.Status != Open)
            throw new BusinessException("Only an open enrollment's attestation can change.", "FIELD_PLAN_ENROLLMENT_NOT_OPEN");
        var known = FieldPlanPrograms.StatementsFor(enrollment.ProgramKey).Select(s => s.Key).ToHashSet();
        if (attestation.Confirmations.Keys.Any(k => !known.Contains(k)))
            throw new ValidationException("attestation.confirmations", "Unknown attestation statement.");
        enrollment.Attestation = JsonSerializer.Serialize(attestation, FieldPlanPrograms.Json);
        Touch(enrollment);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_UPDATE", "ProgramEnrollment", key, enrollment.CustomerId);
        return ToResponse(enrollment);
    }

    /// <summary>
    /// Attests an open enrollment. The listed records must be exactly the producer's records in the program
    /// that year, none still Draft (checked against the database, not the request), the attestation complete,
    /// and no field already in another producer's attested enrollment. The snapshot kept is built from the
    /// database, with the browser's projected scores.
    /// </summary>
    public async Task<ProgramEnrollmentResponse> AttestAsync(Guid key, IReadOnlyList<JsonElement> listed, CancellationToken ct)
    {
        var enrollment = await RequireEnrollmentAsync(key, ct);
        if (enrollment.Status != Open)
            throw new BusinessException("Only an open enrollment can be attested.", "FIELD_PLAN_ENROLLMENT_NOT_OPEN");

        var rows = await _repository.LoadAsync(enrollment.CustomerId, ct);
        var seasons = rows.Seasons.Where(s => s.CropYear == enrollment.CropYear).ToDictionary(s => s.Id);
        var fields = rows.Fields.ToDictionary(f => f.Id);
        var records = rows.Records
            .Where(r => r.ProgramKey == enrollment.ProgramKey && seasons.ContainsKey(r.ProducerFieldSeasonId))
            .ToDictionary(r => r.Id.ToString(CultureInfo.InvariantCulture));

        var listedIds = listed.Select(l => l.ValueKind == JsonValueKind.Object && l.TryGetProperty("recordId", out var id)
            && id.ValueKind == JsonValueKind.String ? id.GetString() : null).ToList();
        if (listedIds.Any(id => id is null) || !listedIds.ToHashSet().SetEquals(records.Keys) || listedIds.Count != records.Count)
            throw new BusinessException("The fields listed don't match this producer's fields in the program; reload and try again.", "FIELD_PLAN_STALE_LIST");

        var blockers = new List<string>();
        if (records.Count == 0) blockers.Add("at least one field");
        var nameOf = (FieldProgramRecord r) => fields[seasons[r.ProducerFieldSeasonId].ProducerFieldId].Name;
        var unscored = records.Values.Where(r => r.Status == Draft).Select(nameOf).ToList();
        if (unscored.Count > 0) blockers.Add($"finish the inputs for {string.Join(", ", unscored)}");

        var a = JsonSerializer.Deserialize<ProgramAttestationDto>(enrollment.Attestation, FieldPlanPrograms.Json)!;
        if (string.IsNullOrWhiteSpace(a.SignerName)) blockers.Add("who signed");
        if (string.IsNullOrEmpty(a.SignedOn)) blockers.Add("date signed");
        if (a.Method == "Paper" && string.IsNullOrWhiteSpace(a.DocumentRef)) blockers.Add("the signed form's document reference");
        foreach (var s in FieldPlanPrograms.StatementsFor(enrollment.ProgramKey))
            if (!a.Confirmations.GetValueOrDefault(s.Key)) blockers.Add(s.Short);

        // A split is one producer's field (unique SplitId), so this only trips on data from before that held.
        var claimed = (await _repository.GetAttestedAsync(enrollment.ProgramKey, enrollment.CropYear, ct))
            .Where(o => o.EnrollmentKey != key)
            .SelectMany(o => SnapshotValues(o.Snapshot, "splitId"))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var r in records.Values)
        {
            var field = fields[seasons[r.ProducerFieldSeasonId].ProducerFieldId];
            if (claimed.Contains(field.SplitId)) blockers.Add($"{field.Name} ({field.SplitId}) is already in another attested enrollment");
        }
        if (blockers.Count > 0)
            throw new BusinessException($"Before attesting: {string.Join("; ", blockers)}.", "FIELD_PLAN_ATTEST_BLOCKED", StatusCodes.Status422UnprocessableEntity);

        enrollment.Status = Attested;
        enrollment.AttestedBy = User;
        enrollment.AttestedAt = Now;
        enrollment.Snapshot = Snapshot(listed, records, seasons, fields).ToJsonString(FieldPlanPrograms.Json);
        Touch(enrollment);
        await _repository.SaveChangesAsync(ct);
        Audit("AUDIT_ATTEST", "ProgramEnrollment", key, enrollment.CustomerId);
        return ToResponse(enrollment);
    }

    /// <summary>
    /// The attested snapshot, one entry per listed record. What the database knows (the field, split, crop, acres
    /// and status) comes from the database; only the projected score the browser showed comes from the request,
    /// and only when it has the expected shape. Other producers' attestations read <c>splitId</c> from here, so
    /// it must never be the client's.
    /// </summary>
    private static JsonArray Snapshot(IReadOnlyList<JsonElement> listed, Dictionary<string, FieldProgramRecord> records,
        Dictionary<int, ProducerFieldSeason> seasons, Dictionary<int, ProducerField> fields)
    {
        var snapshot = new JsonArray();
        foreach (var item in listed)
        {
            var record = records[item.GetProperty("recordId").GetString()!];
            var season = seasons[record.ProducerFieldSeasonId];
            var field = fields[season.ProducerFieldId];
            var entry = new JsonObject
            {
                ["recordId"] = record.Id.ToString(CultureInfo.InvariantCulture),
                ["seasonId"] = season.Id.ToString(CultureInfo.InvariantCulture),
                ["fieldKey"] = field.SplitId,
                ["fieldName"] = field.Name,
                ["splitId"] = field.SplitId,
                ["cropLabel"] = season.CropLabel,
                ["year"] = season.CropYear,
                ["acres"] = season.Acres,
                ["status"] = record.Status,
            };
            if (ShortString(item, "enrollmentId", 40) is { } enrollmentId) entry["enrollmentId"] = enrollmentId;
            if (item.TryGetProperty("score", out var score) && score.ValueKind == JsonValueKind.Object
                && score.TryGetProperty("value", out var value) && value.ValueKind == JsonValueKind.Number
                && ShortString(score, "unit", 40) is { } unit && ShortString(score, "unitShort", 20) is { } unitShort)
                entry["score"] = new JsonObject { ["value"] = value.GetDouble(), ["unit"] = unit, ["unitShort"] = unitShort };
            if (ShortString(item, "scoreNote", 200) is { } note) entry["scoreNote"] = note;
            if (item.TryGetProperty("production", out var production) && production.ValueKind == JsonValueKind.Number)
                entry["production"] = production.GetDouble();
            snapshot.Add(entry);
        }
        return snapshot;
    }

    private static string? ShortString(JsonElement item, string property, int maxLength) =>
        item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
        && value.GetString() is { Length: > 0 } text && text.Length <= maxLength ? text : null;

    /// <summary>Withdraws the enrollment, keeping it and its reason. Re-enrolling adds a new enrollment.</summary>
    public async Task<ProgramEnrollmentResponse> WithdrawAsync(Guid key, string reason, CancellationToken ct)
    {
        var enrollment = await RequireEnrollmentAsync(key, ct);
        if (string.IsNullOrWhiteSpace(reason))
            throw new ValidationException("reason", "Give a reason for withdrawing.");
        if (enrollment.Status != Withdrawn)
        {
            enrollment.Status = Withdrawn;
            enrollment.WithdrawnReason = reason.Trim();
            Touch(enrollment);
            await _repository.SaveChangesAsync(ct);
            Audit("AUDIT_WITHDRAW", "ProgramEnrollment", key, enrollment.CustomerId);
        }
        return ToResponse(enrollment);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private async Task<ProducerFieldSeason> RequireSeasonAsync(int seasonId, CancellationToken ct) =>
        await _repository.GetSeasonAsync(seasonId, ct) ?? throw new NotFoundException("Field season", seasonId);

    private async Task<FieldProgramRecord> RequireRecordAsync(int recordId, CancellationToken ct) =>
        await _repository.GetRecordAsync(recordId, ct) ?? throw new NotFoundException("Program record", recordId);

    private async Task<ProgramEnrollment> RequireEnrollmentAsync(Guid key, CancellationToken ct) =>
        await _repository.GetEnrollmentAsync(key, ct) ?? throw new NotFoundException("Enrollment", key);

    private static string StatusFor(FieldProgramRecord record, ProducerFieldSeason season)
    {
        using var doc = JsonDocument.Parse(record.Data);
        return FieldPlanPrograms.StatusFor(record.ProgramKey, doc.RootElement, season);
    }

    private async Task<string?> CropGroupAsync(int plantingIntentionId, string cropLabel, CancellationToken ct) =>
        FieldPlanCropGroups.For(await _repository.GetPlantingIntentionCropAsync(plantingIntentionId, ct)) ?? FieldPlanCropGroups.ForLabel(cropLabel);

    private static int ParseId(string id, string name) =>
        int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var value)
            ? value
            : throw new ValidationException(name, $"{name} isn't a valid id.");

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>CTRM customer (split) codes: 1 to 7 letters or digits (CtrmCustomerCodes.MaxLength).</summary>
    private static bool IsSplitCode(string id) => id.Length is >= 1 and <= 7 && id.All(char.IsAsciiLetterOrDigit);

    private static HashSet<string> SnapshotRecordIds(string? snapshot) => SnapshotValues(snapshot, "recordId").ToHashSet();

    private static IEnumerable<string> SnapshotValues(string? snapshot, string property)
    {
        if (snapshot is null) yield break;
        // Read defensively: a snapshot saved before they were built on the server came from the browser.
        foreach (var item in JsonNode.Parse(snapshot) as JsonArray ?? [])
            if (item is JsonObject entry && entry[property] is JsonValue v && v.TryGetValue<string>(out var value)) yield return value;
    }

    private void Touch(ProducerField e) { e.ModifiedAt = Now; e.ModifiedBy = User; }
    private void Touch(ProducerFieldSeason e) { e.ModifiedAt = Now; e.ModifiedBy = User; }
    private void Touch(FieldProgramRecord e) { e.ModifiedAt = Now; e.ModifiedBy = User; }
    private void Touch(ProgramEnrollment e) { e.ModifiedAt = Now; e.ModifiedBy = User; }

    private void SoftDelete(ProducerFieldSeason e) { e.IsDeleted = true; e.DeletedAt = Now; e.DeletedBy = User; }
    private void SoftDelete(FieldProgramRecord e) { e.IsDeleted = true; e.DeletedAt = Now; e.DeletedBy = User; }

    private void Audit(string code, string entity, object id, long customerId) =>
        _logger.LogInformation(
            "Field plan {Entity} changed [{ErrorCode}] [{ErrorCategory}]: Id={Id}, CustomerId={CustomerId}, User={User}",
            entity, code, "DataMutation", id, customerId, User);

    // ── Mapping ─────────────────────────────────────────────────────────────

    private static JsonElement Element(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
    private static JsonElement? ElementOrNull(string? json) => json is null ? null : Element(json);

    private static ProducerFieldResponse ToResponse(ProducerField f) => new()
    {
        FieldKey = f.SplitId,
        SplitId = f.SplitId,
        CustomerId = f.CustomerId,
        Name = f.Name,
        SplitPercent = f.SplitPercent,
        EffectiveDate = f.EffectiveDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
        State = f.State ?? "",
        County = f.County ?? "",
        SplitSource = f.SplitSource,
    };

    private static FieldSeasonResponse ToResponse(ProducerFieldSeason s, string splitId) => new()
    {
        Id = s.Id.ToString(CultureInfo.InvariantCulture),
        FieldKey = splitId,
        PlantingIntentionId = s.PlantingIntentionId,
        Year = s.CropYear,
        CropLabel = s.CropLabel,
        Acres = s.Acres,
    };

    private static FieldProgramRecordResponse ToResponse(FieldProgramRecord r) => new()
    {
        Id = r.Id.ToString(CultureInfo.InvariantCulture),
        SeasonId = r.ProducerFieldSeasonId.ToString(CultureInfo.InvariantCulture),
        ProgramKey = r.ProgramKey,
        Data = Element(r.Data),
        Status = r.Status,
        CopiedFromYear = r.CopiedFromYear,
        CopiedFromField = r.CopiedFromField,
        Frozen = ElementOrNull(r.Frozen),
        Official = ElementOrNull(r.Official),
        Reopened = ElementOrNull(r.Reopened),
    };

    private static ProgramEnrollmentResponse ToResponse(ProgramEnrollment e) => new()
    {
        Key = e.EnrollmentKey.ToString(),
        ProgramKey = e.ProgramKey,
        CustomerId = e.CustomerId,
        Year = e.CropYear,
        Status = e.Status,
        Attestation = Element(e.Attestation),
        AttestedBy = e.AttestedBy,
        AttestedAt = e.AttestedAt,
        Snapshot = ElementOrNull(e.Snapshot),
        WithdrawnReason = e.WithdrawnReason,
    };
}
