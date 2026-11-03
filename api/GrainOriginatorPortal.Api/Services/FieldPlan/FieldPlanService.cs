using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Ctrm;
using GrainOriginatorPortal.Api.Services.FdCic;
using GrainOriginatorPortal.Api.Services.TDisc;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Services.FieldPlan;

/// <summary>
/// The field plan: a producer's fields (CTRM splits), their seasons on crop rows, each season's program
/// records. Mirrors the client's FieldPlanBackend contract, one method per call, and owns the rules that
/// must hold across users (see
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
}

/// <inheritdoc />
public sealed class FieldPlanService : IFieldPlanService
{
    private const string Locked = "Locked";

    private readonly IFieldPlanRepository _repository;
    private readonly IProducerSplitService _splits;
    private readonly IFdCicService _fdCic;
    private readonly ITDiscService _tDisc;
    private readonly IFieldTicketService _tickets;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<FieldPlanService> _logger;
    private readonly TimeProvider _clock;

    public FieldPlanService(IFieldPlanRepository repository, IProducerSplitService splits, IFdCicService fdCic, ITDiscService tDisc, IFieldTicketService tickets,
        IRequestContextService requestContext, ILogger<FieldPlanService> logger, TimeProvider? clock = null)
    {
        _repository = repository;
        _splits = splits;
        _fdCic = fdCic;
        _tDisc = tDisc;
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
        try
        {
            await _repository.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // Two adds of the field to this row at once: the unique index (UQ_ProducerFieldSeason_Field_PlantingIntention)
            // stops the second, which gets the same answer as the check above.
            throw new BusinessException($"{field.Name} is already on the {season.CropLabel} row for {request.Year}.", "FIELD_PLAN_FIELD_ON_ROW", StatusCodes.Status409Conflict);
        }
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

        // A confirmed CI is unlocked with its estimate: both go to the history, and the field can be reviewed again.
        KeepInHistory(record, reason.Trim());
        RestoreEstimatedTillage(record);
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
    /// A confirm that T-DISC stepped down saved the confirmed tillage in the data; reopening puts back the tillage the
    /// field was estimated at, so the next review rates it from where it started (and still asks for T-DISC).
    /// </summary>
    private static void RestoreEstimatedTillage(FieldProgramRecord record)
    {
        if (record.Official is null) return;
        var estimated = JsonNode.Parse(record.Official)?["tDisc"]?["estimatedTillage"]?.GetValue<string>();
        if (FieldPlanPrograms.TillageKey(estimated) is not { } tillage) return;
        var data = JsonNode.Parse(record.Data)!.AsObject();
        data["tillage"] = tillage;
        record.Data = data.ToJsonString(FieldPlanPrograms.Json);
    }

    /// <summary>
    /// Confirms a 45Z field after harvest, once the originator has gone over its inputs and CTRM tickets with
    /// the producer. The tickets are read again here and only the listed keys are kept, so the bushels are
    /// CTRM's, never the request's. A no-till or reduced-till field needs its passes, which are rated here with
    /// USDA T-DISC, and is confirmed at the tillage that rating supports (FieldPlanTDisc). The actual yield is set, the CI is rescored with
    /// the server's calculator and the record locked, and the confirmed CI with its bushels and tickets becomes
    /// the record's official result: what the Mass Balance Ledger and the Biofuel Feedstock Report are built from.
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
            throw new ValidationException("reviewedWithProducer", "Confirm that the recordkeeping requirements were reviewed with the producer.");
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
        var estimatedTillage = data["tillage"]?.GetValue<string>() ?? "";
        JsonObject? tDisc = null;
        // Only the server's rating counts: whatever the saved data says is replaced here.
        data["tDiscRating"] = null;
        data["tDiscPasses"] = null;
        if (FieldPlanTDisc.IsNeeded(estimatedTillage))
        {
            if (request.TDiscPasses is not { Count: > 0 } passes)
                throw new BusinessException("Add the field's passes for T-DISC (No till and Reduced till need a T-DISC rating).",
                    "FIELD_PLAN_TDISC_REQUIRED", StatusCodes.Status422UnprocessableEntity);
            if (passes.Any(p => p is null))
                throw new ValidationException("tDiscPasses", "A T-DISC pass is empty.");
            var result = _tDisc.Rate(passes.Select(p => new TDiscPassInput(p.Window, p.Implement)).ToList());
            var designation = FieldPlanTDisc.Tillage(result.Designation);
            var confirmedTillage = FieldPlanTDisc.SupportedTillage(estimatedTillage, result.Designation);
            data["tDiscRating"] = result.Rating;
            data["tDiscPasses"] = JsonSerializer.SerializeToNode(passes.Select(p => new { p.Window, p.Implement }), FieldPlanPrograms.Json);
            data["tillage"] = confirmedTillage;
            tDisc = new JsonObject
            {
                ["rating"] = result.Rating,
                ["designation"] = FieldPlanPrograms.TillageLabel(designation),
                ["estimatedTillage"] = FieldPlanPrograms.TillageLabel(estimatedTillage),
                ["confirmedTillage"] = FieldPlanPrograms.TillageLabel(confirmedTillage),
                ["version"] = result.Label,
                ["windows"] = JsonSerializer.SerializeToNode(result.Windows, FieldPlanPrograms.Json),
                ["passes"] = JsonSerializer.SerializeToNode(result.Passes, FieldPlanPrograms.Json),
            };
        }
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
            ["tDisc"] = tDisc,
            ["recordkeepingAcknowledged"] = true,
            ["documentedBy"] = User,
            ["documentedByName"] = _requestContext.GetCurrentUserDisplayName(),
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

    // ── Helpers ─────────────────────────────────────────────────────────────

    private async Task<ProducerFieldSeason> RequireSeasonAsync(int seasonId, CancellationToken ct) =>
        await _repository.GetSeasonAsync(seasonId, ct) ?? throw new NotFoundException("Field season", seasonId);

    private async Task<FieldProgramRecord> RequireRecordAsync(int recordId, CancellationToken ct) =>
        await _repository.GetRecordAsync(recordId, ct) ?? throw new NotFoundException("Program record", recordId);

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

    private void Touch(ProducerField e) { e.ModifiedAt = Now; e.ModifiedBy = User; }
    private void Touch(ProducerFieldSeason e) { e.ModifiedAt = Now; e.ModifiedBy = User; }
    private void Touch(FieldProgramRecord e) { e.ModifiedAt = Now; e.ModifiedBy = User; }

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
}
