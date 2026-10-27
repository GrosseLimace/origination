// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Services.Ctrm;
using GrainOriginatorPortal.Api.Services.FdCic;
using GrainOriginatorPortal.Api.Services.FieldPlan;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Services.FieldPlan;

/// <summary>
/// The rules the field-plan server owns (docs/application-context/Field Plan - Database Plan.md): a split is
/// one producer's field and its CTRM details come from CTRM, locking rescores 45Z on the server, locked
/// records can't change, held records can't be reopened, and attesting checks the database, not the request.
/// Runs against EF InMemory through the real repository, so soft-delete filters are exercised too.
/// </summary>
public class FieldPlanServiceTests
{
    private const long Tobin = 260843, Other = 999;
    private const int CornRow = 10, WheatRow = 11, OtherRow = 12;
    private const string User = "tester@scoular.com";

    private static readonly Lazy<FdCicService> FdCic = new(() => new FdCicService(
        new FdCicSettings(new Dictionary<int, string> { [2026] = "1.2" }), [new FdCicMethodV1()], NullLogger<FdCicService>.Instance));

    private static readonly JsonElement StoryCorn = Json("""
        { "expectedYield": 190, "actualYield": 200, "syntheticN": 180, "niFraction": 0.5,
          "coverCrop": "None", "tillage": "NoTill", "manure": [] }
        """);

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private sealed class Harness
    {
        public required ApplicationDbContext Db { get; init; }
        public required FieldPlanService Service { get; init; }
    }

    private static Harness New()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"field-plan-{Guid.NewGuid()}").Options);
        db.Customers.Add(new Customer { Id = Tobin, Name = "T-A TOBIN FARMS LC", ScoularId = "TATOBIN" });
        db.Customers.Add(new Customer { Id = Other, Name = "Other Farm", ScoularId = "OTHER" });
        db.PlantingIntentions.Add(new PlantingIntention { Id = CornRow, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2026, Crop = "Irrigated Corn", Acres = 500, CreatedBy = "x" });
        db.PlantingIntentions.Add(new PlantingIntention { Id = WheatRow, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2026, Crop = "Wheat", Acres = 200, CreatedBy = "x" });
        db.PlantingIntentions.Add(new PlantingIntention { Id = OtherRow, CustomerId = Other, TradeUnit = "2190", PlantingYear = 2026, Crop = "Corn", Acres = 100, CreatedBy = "x" });
        db.SaveChanges();

        var splits = new Mock<IProducerSplitService>();
        splits.Setup(s => s.GetByCustomerAsync(It.IsAny<long>(), It.IsAny<CancellationToken>())).ReturnsAsync((long id, CancellationToken _) => new ProducerSplitsResponse
        {
            Source = "sample",
            Splits = id == Tobin
                ? [Split("TATOB43", "JARBOE WEST"), Split("TATOB44", "NORTH 80"), Split("TATOB45", "BIN") with { Kind = "Bin" }, Split("TATOB46", "OLD") with { Expired = true }]
                : [Split("OTHER01", "HOME")],
        });
        var context = new Mock<IRequestContextService>();
        context.Setup(c => c.GetCurrentUser()).Returns(User);

        return new Harness
        {
            Db = db,
            Service = new FieldPlanService(new FieldPlanRepository(db), splits.Object, FdCic.Value, context.Object, NullLogger<FieldPlanService>.Instance),
        };
    }

    private static ProducerSplitResponse Split(string id, string name) => new()
    {
        SplitId = id, PrimaryCustomerId = "TATOBIN", Name = $"T-A TOBIN - {name}", FieldName = name,
        SplitPercent = 66.667m, EffectiveDate = "2020-11-01", Expired = false, Kind = "Field",
    };

    /// <summary>A Story County, IA corn field with 120 acres on the corn row and a 45Z record.</summary>
    private static async Task<(FieldSeasonResponse Season, FieldProgramRecordResponse Record)> CornField(Harness h, string splitId = "TATOB43", JsonElement? data = null)
    {
        await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = splitId, State = "ia", County = "Story" }, default);
        var season = await h.Service.AddSeasonAsync(new CreateFieldSeasonRequest { FieldKey = splitId, PlantingIntentionId = CornRow, Year = 2026, CropLabel = "Irrigated Corn", Acres = 120 }, default);
        var record = await h.Service.AddRecordAsync(new CreateFieldProgramRecordRequest { SeasonId = season.Id, ProgramKey = FieldPlanPrograms.FdCic, Data = data ?? StoryCorn }, default);
        return (season, record);
    }

    private static async Task<ProgramEnrollmentResponse> SignedEnrollment(Harness h)
    {
        var e = (await h.Service.EnsureEnrollmentAsync(new EnsureProgramEnrollmentRequest { ProgramKey = FieldPlanPrograms.FdCic, CustomerId = Tobin, Year = 2026 }, default))!;
        return await h.Service.UpdateAttestationAsync(Guid.Parse(e.Key), new ProgramAttestationDto
        {
            SignerName = "Tom Tobin", SignedOn = "2026-04-01", Method = "eSign", DocumentRef = "",
            Confirmations = FieldPlanPrograms.StatementsFor(FieldPlanPrograms.FdCic).ToDictionary(s => s.Key, _ => true),
        }, default);
    }

    /// <summary>One EnrollableRecord as the client sends it (only the parts the server reads matter).</summary>
    private static JsonElement Listed(FieldProgramRecordResponse record) =>
        Json(JsonSerializer.Serialize(new { recordId = record.Id, splitId = "TATOB43", fieldName = "JARBOE WEST", status = record.Status }));

    // ── Fields ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task CreateField_TakesTheSplitsDetailsFromCtrm_AndUpperCasesIt()
    {
        var h = New();

        var field = await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = " tatob43 ", State = "ks", County = "Pratt" }, default);

        Assert.Equal(("TATOB43", "TATOB43", "JARBOE WEST", 66.667m, "2020-11-01", "KS", "Pratt"),
            (field.FieldKey, field.SplitId, field.Name, field.SplitPercent, field.EffectiveDate, field.State, field.County));
        Assert.Equal(User, h.Db.ProducerFields.Single().CreatedBy);
    }

    [Fact]
    public async Task CreateField_TheSameSplitAgain_ReturnsIt_ButAnotherProducerIsRefused()
    {
        var h = New();
        await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB43" }, default);

        await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB43" }, default);
        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Other, SplitId = "TATOB43" }, default));

        Assert.Equal("FIELD_PLAN_SPLIT_TAKEN", ex.ErrorCode);
        Assert.Single(h.Db.ProducerFields);
    }

    [Theory]
    [InlineData("NOPE99", "FIELD_PLAN_UNKNOWN_SPLIT")]
    [InlineData("TATOB45", "FIELD_PLAN_SPLIT_NOT_A_FIELD")]
    [InlineData("TATOB46", "FIELD_PLAN_SPLIT_NOT_A_FIELD")]
    public async Task CreateField_OnlyTheProducersOwnLiveFieldSplits(string splitId, string code)
    {
        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            New().Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = splitId }, default));

        Assert.Equal(code, ex.ErrorCode);
    }

    [Fact]
    public async Task AddSeason_RefusesAnotherProducersCropRow_OrAnotherYear()
    {
        var h = New();
        await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB43" }, default);

        await Assert.ThrowsAsync<ValidationException>(() => h.Service.AddSeasonAsync(
            new CreateFieldSeasonRequest { FieldKey = "TATOB43", PlantingIntentionId = OtherRow, Year = 2026, CropLabel = "Corn" }, default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.AddSeasonAsync(
            new CreateFieldSeasonRequest { FieldKey = "TATOB43", PlantingIntentionId = CornRow, Year = 2027, CropLabel = "Irrigated Corn" }, default));
    }

    // ── Records ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Records_StatusIsWorkedOutByTheServer()
    {
        var h = New();
        var (_, record) = await CornField(h, data: Json("""{ "expectedYield": null, "actualYield": null, "syntheticN": null, "niFraction": 0, "coverCrop": "None", "tillage": "NoneOfTheAbove", "manure": [] }"""));
        Assert.Equal("Draft", record.Status);

        var saved = await h.Service.UpdateRecordAsync(int.Parse(record.Id), new UpdateFieldProgramRecordRequest { Data = StoryCorn, CopiedFromField = "NORTH 80" }, default);

        Assert.Equal("Ready", saved.Status);
        Assert.Equal("NORTH 80", saved.CopiedFromField);
    }

    [Fact]
    public async Task AddRecord_IsOncePerProgramPerSeason_AndOnlyWhereTheProgramApplies()
    {
        var h = New();
        var (season, record) = await CornField(h);

        var again = await h.Service.AddRecordAsync(new CreateFieldProgramRecordRequest { SeasonId = season.Id, ProgramKey = FieldPlanPrograms.FdCic, Data = StoryCorn }, default);

        Assert.Equal(record.Id, again.Id);
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.AddRecordAsync(
            new CreateFieldProgramRecordRequest { SeasonId = season.Id, ProgramKey = FieldPlanPrograms.GrainCraft, Data = Json("""{ "variety": "Zenda" }""") }, default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.AddRecordAsync(
            new CreateFieldProgramRecordRequest { SeasonId = season.Id, ProgramKey = "made-up", Data = StoryCorn }, default));
    }

    [Fact]
    public async Task UpdateRecord_RefusesDataThatIsntThePrograms()
    {
        var h = New();
        var (_, record) = await CornField(h);

        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UpdateRecordAsync(int.Parse(record.Id),
            new UpdateFieldProgramRecordRequest { Data = Json("""{ "tillage": "Plowed", "coverCrop": "None", "niFraction": 0, "manure": [] }""") }, default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UpdateRecordAsync(int.Parse(record.Id),
            new UpdateFieldProgramRecordRequest { Data = Json("[1, 2]") }, default));
    }

    // ── Locking ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lock_RescoresWithTheServersCalculator_AndStampsTheVersionAndUser()
    {
        var h = New();
        var (_, record) = await CornField(h);

        var locked = await h.Service.LockAsync(int.Parse(record.Id), default);

        Assert.Equal("Locked", locked.Status);
        var frozen = locked.Frozen!.Value;
        // Story County corn, 200 bu actual: the golden-case CI in FdCicServiceTests.
        Assert.Equal(3070.75, frozen.GetProperty("score").GetProperty("value").GetDouble(), 2);
        Assert.Equal(3070.75, frozen.GetProperty("outputs").GetProperty("ciGPerBu").GetDouble(), 2);
        Assert.Equal("USDA FD-CIC v1.2", frozen.GetProperty("calculatorVersion").GetString());
        Assert.Equal(FdCicMethodV1.Fingerprint, frozen.GetProperty("outputs").GetProperty("usdaFormulaFingerprint").GetString());
        Assert.Equal("Estimate", frozen.GetProperty("basis").GetString());
        Assert.Equal(User, frozen.GetProperty("lockedBy").GetString());
        Assert.Equal("No till", frozen.GetProperty("inputs").GetProperty("tillage").GetString());
        Assert.Equal(50, frozen.GetProperty("inputs").GetProperty("niPercent").GetDouble());
        Assert.Equal(7, frozen.GetProperty("outputs").GetProperty("breakdown").GetArrayLength());
        Assert.Equal(User, h.Db.FieldProgramRecords.Single().LockedBy);
    }

    [Fact]
    public async Task Lock_WithoutAnActualYield_SaysWhatsMissing()
    {
        var h = New();
        var (_, record) = await CornField(h, data: Json("""{ "expectedYield": 190, "actualYield": null, "syntheticN": 180, "niFraction": 0, "coverCrop": "None", "tillage": "NoTill", "manure": [] }"""));

        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.LockAsync(int.Parse(record.Id), default));

        Assert.Equal("FIELD_PLAN_LOCK_INCOMPLETE", ex.ErrorCode);
        Assert.Contains("actual yield", ex.Message);
        Assert.Equal("Ready", h.Db.FieldProgramRecords.Single().Status);
    }

    [Fact]
    public async Task Lock_GrainCraft_FreezesTheVariety()
    {
        var h = New();
        await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB44" }, default);
        var season = await h.Service.AddSeasonAsync(new CreateFieldSeasonRequest { FieldKey = "TATOB44", PlantingIntentionId = WheatRow, Year = 2026, CropLabel = "Wheat", Acres = 80 }, default);
        var record = await h.Service.AddRecordAsync(new CreateFieldProgramRecordRequest { SeasonId = season.Id, ProgramKey = FieldPlanPrograms.GrainCraft, Data = Json("""{ "variety": " Zenda " }""") }, default);

        var locked = await h.Service.LockAsync(int.Parse(record.Id), default);

        Assert.Equal("Zenda", locked.Frozen!.Value.GetProperty("inputs").GetProperty("variety").GetString());
        Assert.Equal("GrainCraft field record v1", locked.Frozen.Value.GetProperty("calculatorVersion").GetString());
    }

    [Fact]
    public async Task ALockedRecord_CantBeEdited_NorItsSeasonChangedOrRemoved_AndRemovingItKeepsIt()
    {
        var h = New();
        var (season, record) = await CornField(h);
        await h.Service.LockAsync(int.Parse(record.Id), default);
        var seasonId = int.Parse(season.Id);

        await Assert.ThrowsAsync<BusinessException>(() => h.Service.UpdateRecordAsync(int.Parse(record.Id), new UpdateFieldProgramRecordRequest { Data = StoryCorn }, default));
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.UpdateSeasonAsync(seasonId, new UpdateFieldSeasonRequest { Acres = 10 }, default));
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.RemoveSeasonAsync(seasonId, default));
        await h.Service.RemoveRecordAsync(int.Parse(record.Id), default);

        Assert.Single((await h.Service.LoadAsync(Tobin, default)).Records);
    }

    // ── Reopening ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Reopen_KeepsTheUnlockedEstimate_AndReopensTheHarvest()
    {
        var h = New();
        var (_, record) = await CornField(h);
        var enrollment = await SignedEnrollment(h);
        await h.Service.LockAsync(int.Parse(record.Id), default);
        await h.Service.SetHarvestCompleteAsync(Guid.Parse(enrollment.Key), true, default);

        var reopened = await h.Service.ReopenAsync(int.Parse(record.Id), "  wrong yield ", default);

        Assert.Equal("Ready", reopened.Record.Status);
        Assert.Null(reopened.Record.Frozen);
        var history = reopened.Record.Reopened!.Value;
        Assert.Equal("wrong yield", history[0].GetProperty("reason").GetString());
        Assert.Equal(3070.75, history[0].GetProperty("frozen").GetProperty("score").GetProperty("value").GetDouble(), 2);
        Assert.Null(reopened.Enrollment!.HarvestCompleteAt);
    }

    [Fact]
    public async Task Reopen_IsRefusedWhileAnAttestedEnrollmentHoldsTheRecord()
    {
        var h = New();
        var (_, record) = await CornField(h);
        var enrollment = await SignedEnrollment(h);
        await h.Service.AttestAsync(Guid.Parse(enrollment.Key), [Listed(record)], default);
        await h.Service.LockAsync(int.Parse(record.Id), default);

        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.ReopenAsync(int.Parse(record.Id), "fix", default));

        Assert.Equal("FIELD_PLAN_HELD", ex.ErrorCode);
    }

    // ── Enrollments ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Attest_ChecksTheAttestationAndTheDatabasesStatus()
    {
        var h = New();
        var (_, record) = await CornField(h, data: Json("""{ "expectedYield": null, "actualYield": null, "syntheticN": null, "niFraction": 0, "coverCrop": "None", "tillage": "NoneOfTheAbove", "manure": [] }"""));
        var e = (await h.Service.EnsureEnrollmentAsync(new EnsureProgramEnrollmentRequest { ProgramKey = FieldPlanPrograms.FdCic, CustomerId = Tobin, Year = 2026 }, default))!;
        // The client claims Ready; the database says Draft.
        var listed = Listed(record with { Status = "Ready" });

        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.AttestAsync(Guid.Parse(e.Key), [listed], default));

        Assert.Contains("finish the inputs for JARBOE WEST", ex.Message);
        Assert.Contains("who signed", ex.Message);
        Assert.Contains("consent to third-party audit", ex.Message);
    }

    [Fact]
    public async Task Attest_RefusesAListThatDoesntMatchTheProducersRecords()
    {
        var h = New();
        await CornField(h);
        var enrollment = await SignedEnrollment(h);

        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.AttestAsync(Guid.Parse(enrollment.Key), [], default));

        Assert.Equal("FIELD_PLAN_STALE_LIST", ex.ErrorCode);
    }

    [Fact]
    public async Task Attest_KeepsTheSnapshotAndWhoAttested_ThenWithdrawAndReEnrollStartsANewEnrollment()
    {
        var h = New();
        var (_, record) = await CornField(h);
        var enrollment = await SignedEnrollment(h);
        var key = Guid.Parse(enrollment.Key);

        var attested = await h.Service.AttestAsync(key, [Listed(record)], default);
        Assert.Equal(("Attested", User), (attested.Status, attested.AttestedBy));
        Assert.Equal(record.Id, attested.Snapshot!.Value[0].GetProperty("recordId").GetString());

        var withdrawn = await h.Service.WithdrawAsync(key, "producer changed buyers", default);
        var again = await h.Service.EnsureEnrollmentAsync(new EnsureProgramEnrollmentRequest { ProgramKey = FieldPlanPrograms.FdCic, CustomerId = Tobin, Year = 2026 }, default);

        Assert.Equal(("Withdrawn", "producer changed buyers"), (withdrawn.Status, withdrawn.WithdrawnReason));
        Assert.NotEqual(enrollment.Key, again!.Key);
        Assert.Equal("Open", again.Status);
        Assert.Equal(2, (await h.Service.LoadAsync(Tobin, default)).Enrollments.Count);
    }

    [Fact]
    public async Task EnsureEnrollment_IsNullForAProgramWithoutEnrollment_AndReturnsTheLiveOne()
    {
        var h = New();
        var request = new EnsureProgramEnrollmentRequest { ProgramKey = FieldPlanPrograms.FdCic, CustomerId = Tobin, Year = 2026 };

        var first = await h.Service.EnsureEnrollmentAsync(request, default);
        var second = await h.Service.EnsureEnrollmentAsync(request, default);

        Assert.Equal(first!.Key, second!.Key);
        Assert.False(first.Attestation.GetProperty("confirmations").GetProperty("recordsAccurate").GetBoolean());
        Assert.Null(await h.Service.EnsureEnrollmentAsync(request with { ProgramKey = FieldPlanPrograms.GrainCraft }, default));
    }

    [Fact]
    public async Task UpdateAttestation_RefusesStatementsTheProgramDoesntHave()
    {
        var h = New();
        var e = (await h.Service.EnsureEnrollmentAsync(new EnsureProgramEnrollmentRequest { ProgramKey = FieldPlanPrograms.FdCic, CustomerId = Tobin, Year = 2026 }, default))!;

        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UpdateAttestationAsync(Guid.Parse(e.Key), new ProgramAttestationDto
        {
            SignerName = "x", SignedOn = "2026-01-01", Method = "eSign", DocumentRef = "",
            Confirmations = new() { ["somethingElse"] = true },
        }, default));
    }

    // ── Loading and soft delete ─────────────────────────────────────────────

    [Fact]
    public async Task RemoveSeason_SoftDeletesItAndItsRecords_AndLoadNoLongerShowsThem()
    {
        var h = New();
        var (season, _) = await CornField(h);

        await h.Service.RemoveSeasonAsync(int.Parse(season.Id), default);
        var snapshot = await h.Service.LoadAsync(Tobin, default);

        Assert.Single(snapshot.Fields);
        Assert.Empty(snapshot.Seasons);
        Assert.Empty(snapshot.Records);
        Assert.True(h.Db.FieldProgramRecords.IgnoreQueryFilters().Single().IsDeleted);
        Assert.Equal(User, h.Db.ProducerFieldSeasons.IgnoreQueryFilters().Single().DeletedBy);
    }

    [Fact]
    public async Task Load_IsOneProducersPlan_InTheClientsShape()
    {
        var h = New();
        var (season, record) = await CornField(h);

        var snapshot = await h.Service.LoadAsync(Tobin, default);

        Assert.Equal("TATOB43", Assert.Single(snapshot.Seasons).FieldKey);
        Assert.Equal(season.Id, Assert.Single(snapshot.Records).SeasonId);
        Assert.Equal("NoTill", snapshot.Records[0].Data.GetProperty("tillage").GetString());
        Assert.Empty((await h.Service.LoadAsync(Other, default)).Fields);
        Assert.Equal(record.Id, snapshot.Records[0].Id);
    }
}
