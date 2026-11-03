// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
using GrainOriginatorPortal.Api.Services.TDisc;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Services.FieldPlan;

/// <summary>
/// The rules the field-plan server owns (docs/application-context/Field Plan - Database Plan.md): a split is
/// one producer's field and its CTRM details come from CTRM, locking rescores 45Z on the server, locked
/// records can't change until they're unlocked with a reason, and confirming re-reads CTRM and rates T-DISC itself.
/// Runs against EF InMemory through the real repository, so soft-delete filters are exercised too.
/// </summary>
public class FieldPlanServiceTests
{
    private const long Tobin = 260843, Other = 999;
    private const int CornRow = 10, WheatRow = 11, OtherRow = 12;
    private const string User = "tester@scoular.com";

    private static readonly Lazy<FdCicService> FdCic = new(() => new FdCicService(
        new FdCicSettings(new Dictionary<int, string> { [2025] = "1.2", [2026] = "1.2" }), [new FdCicMethodV1()], NullLogger<FdCicService>.Instance));

    private static readonly JsonElement StoryCorn = Json("""
        { "expectedYield": 190, "actualYield": 200, "syntheticN": 180, "niFraction": 0.5,
          "coverCrop": "None", "tillage": "NoTill", "manure": [] }
        """);

    private static readonly Lazy<TDiscService> TDisc = new(() => new TDiscService(NullLogger<TDiscService>.Instance));

    private static TDiscPassRequest Pass(string window, string implement) => new() { Window = window, Implement = implement };

    /// <summary>Passes that rate 0.01 with T-DISC, supporting StoryCorn's no-till.</summary>
    private static List<TDiscPassRequest> NoTillPasses() =>
        [Pass("Planting", "PLANTER, NO-TILL"), Pass("Harvest", "HARVEST, GRAIN")];

    /// <summary>Passes that rate 0.1422 (reduced till): a field cultivator after a coil-tine harrow.</summary>
    private static List<TDiscPassRequest> ReducedTillPasses() =>
        [Pass("Field_Preparation", "CULTIVATOR, FIELD"), Pass("Field_Preparation", "HARROW, COILED TINES"), Pass("Harvest", "HARVEST, GRAIN")];

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private sealed class Harness
    {
        public required ApplicationDbContext Db { get; init; }
        public required FieldPlanService Service { get; init; }
        public required FieldTicketService Tickets { get; init; }
        /// <summary>What CTRM has delivered under the split, and its contracts' crop years (the fake ticket reader).</summary>
        public List<Ticket> CtrmTickets { get; } = [];
        public Dictionary<string, int> ContractYears { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>The CTRM splits path unless a test asks for "manual" (SPLITS-GRAPHQL: the go-live default).</summary>
    private static Harness New(string splitSource = "ctrm")
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"field-plan-{Guid.NewGuid()}").Options);
        db.Customers.Add(new Customer { Id = Tobin, Name = "T-A TOBIN FARMS LC", ScoularId = "TATOBIN" });
        db.Customers.Add(new Customer { Id = Other, Name = "Other Farm", ScoularId = "OTHER" });
        db.PlantingIntentions.Add(new PlantingIntention { Id = CornRow, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2026, Crop = "YC", Type = "Irrigated", Acres = 500, CreatedBy = "x" });
        db.PlantingIntentions.Add(new PlantingIntention { Id = WheatRow, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2026, Crop = "HRWW", Acres = 200, CreatedBy = "x" });
        db.PlantingIntentions.Add(new PlantingIntention { Id = OtherRow, CustomerId = Other, TradeUnit = "2190", PlantingYear = 2026, Crop = "Corn", Acres = 100, CreatedBy = "x" });
        db.SaveChanges();

        var splits = new Mock<IProducerSplitService>();
        splits.Setup(s => s.Source).Returns(splitSource);
        splits.Setup(s => s.GetByCustomerAsync(It.IsAny<long>(), It.IsAny<CancellationToken>())).ReturnsAsync((long id, CancellationToken _) => new ProducerSplitsResponse
        {
            Source = "sample",
            Splits = id == Tobin
                ? [Split("TATOB43", "JARBOE WEST"), Split("TATOB44", "NORTH 80"), Split("TATOB45", "BIN") with { Kind = "Bin" }, Split("TATOB46", "OLD") with { Expired = true }]
                : [Split("OTHER01", "HOME")],
        });
        var context = new Mock<IRequestContextService>();
        context.Setup(c => c.GetCurrentUser()).Returns(User);
        context.Setup(c => c.GetCurrentUserDisplayName()).Returns("Tess Tester");

        var repository = new FieldPlanRepository(db);
        var reader = new Mock<IFieldTicketReader>();
        var commodities = new Mock<ICommodityRepository>();
        commodities.Setup(c => c.GetActiveAsync(It.IsAny<CancellationToken>())).ReturnsAsync([]);
        // Corn's ODS conversion; soybeans are left to the standard weight.
        commodities.Setup(c => c.GetConversionsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([new CommodityConversion { CommodityCode = "YC", LbsPerUnit = 56m }]);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["FieldPlan:TicketWindow:soybeans:From"] = "09-15" })
            .Build();
        var tickets = new FieldTicketService(repository, reader.Object, commodities.Object, config);
        var harness = new Harness
        {
            Db = db,
            Tickets = tickets,
            Service = new FieldPlanService(repository, splits.Object, FdCic.Value, TDisc.Value, tickets, context.Object, NullLogger<FieldPlanService>.Instance),
        };
        reader.Setup(r => r.ReadAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((long _, string split, CancellationToken _) => new CtrmReadResult<FieldTicketRead>
            {
                Status = CtrmReadStatus.Ok,
                Value = new FieldTicketRead(harness.CtrmTickets.Where(t => t.CustomerCode == split).ToList(), harness.ContractYears),
            });
        return harness;
    }

    private static int _nextTicket = 1;

    /// <summary>A CTRM delivery under a split: net pounds for its share, on a contract or not.</summary>
    private static Ticket Delivery(string date, long pounds, string product = "YC", string split = "TATOB43", string? contract = null, DateTime? settled = null) => new()
    {
        Id = 1000 + _nextTicket, TicketNumber = $"P{_nextTicket++}", CustomerCode = split, ProductCode = product, Date = date,
        AppliedDockQuantity = pounds, CtrmContractNumber = contract, FinalSettledDate = settled,
        TicketStatusDescription = settled is null ? "Unload" : "Final Settled", ElevatorCode = "PRA", ElevatorCity = "Pratt", ElevatorState = "KS",
    };

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

    // SPLITS-GRAPHQL: typed by hand until CTRM's splits query is live.
    [Fact]
    public async Task CreateField_Manual_TakesTheTypedNameAndShare_AndMarksItManual()
    {
        var h = New("manual");

        var field = await h.Service.CreateFieldAsync(new CreateProducerFieldRequest
        {
            CustomerId = Tobin, SplitId = " tatob43 ", Name = " Jarboe West ", SplitPercent = 50m, State = "ks", County = "Pratt",
        }, default);

        Assert.Equal(("TATOB43", "Jarboe West", 50m, "Manual", "KS"), (field.SplitId, field.Name, field.SplitPercent, field.SplitSource, field.State));
    }

    [Fact]
    public async Task CreateField_Manual_DefaultsTheNameToTheIdAndTheShareTo100()
    {
        var field = await New("manual").Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "NEW01" }, default);

        Assert.Equal(("NEW01", 100m, ""), (field.Name, field.SplitPercent, field.EffectiveDate));
    }

    [Theory]
    [InlineData("TATOB430")]
    [InlineData("TA-TOB")]
    [InlineData("TA TOB")]
    public async Task CreateField_RefusesAnIdThatIsntACtrmCode(string splitId)
    {
        await Assert.ThrowsAsync<ValidationException>(() =>
            New("manual").Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = splitId }, default));
    }

    [Fact]
    public async Task CreateField_Manual_StillOneProducerPerSplit_AndAnUnknownProducerIsRefused()
    {
        var h = New("manual");
        await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB43" }, default);

        await Assert.ThrowsAsync<BusinessException>(() =>
            h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Other, SplitId = "TATOB43" }, default));
        await Assert.ThrowsAsync<NotFoundException>(() =>
            h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = 12345, SplitId = "XX01" }, default));
    }

    [Fact]
    public async Task UpdateField_ChangesNameAndShareOnlyForManualSplits()
    {
        var manual = New("manual");
        await manual.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB43" }, default);
        var ctrm = New();
        await ctrm.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB43" }, default);
        var change = new UpdateProducerFieldRequest { Name = "Renamed", SplitPercent = 25m, State = "KS", County = "Pratt" };

        var m = await manual.Service.UpdateFieldAsync("TATOB43", change, default);
        var c = await ctrm.Service.UpdateFieldAsync("TATOB43", change, default);

        Assert.Equal(("Renamed", 25m), (m.Name, m.SplitPercent));
        Assert.Equal(("JARBOE WEST", 66.667m, "Pratt"), (c.Name, c.SplitPercent, c.County));
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

    [Fact]
    public async Task AddSeason_RefusesTheSameFieldTwiceForACrop_SoItsTicketsArentCountedTwice()
    {
        var h = New();
        await CornField(h);

        var sameRow = await Assert.ThrowsAsync<BusinessException>(() => h.Service.AddSeasonAsync(
            new CreateFieldSeasonRequest { FieldKey = "TATOB43", PlantingIntentionId = CornRow, Year = 2026, CropLabel = "Irrigated Corn", Acres = 10 }, default));
        // Double cropping is fine: wheat and corn on the same field in a year.
        await h.Service.AddSeasonAsync(new CreateFieldSeasonRequest { FieldKey = "TATOB43", PlantingIntentionId = WheatRow, Year = 2026, CropLabel = "Wheat", Acres = 10 }, default);

        Assert.Equal("FIELD_PLAN_FIELD_ON_ROW", sameRow.ErrorCode);
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
        await h.Service.CreateFieldAsync(new CreateProducerFieldRequest { CustomerId = Tobin, SplitId = "TATOB44" }, default);
        var wheat = await h.Service.AddSeasonAsync(new CreateFieldSeasonRequest { FieldKey = "TATOB44", PlantingIntentionId = WheatRow, Year = 2026, CropLabel = "Wheat", Acres = 80 }, default);
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.AddRecordAsync(
            new CreateFieldProgramRecordRequest { SeasonId = wheat.Id, ProgramKey = FieldPlanPrograms.FdCic, Data = StoryCorn }, default));
        // 45Z is the only program: GrainCraft was never released and is refused like any unknown key.
        foreach (var key in new[] { "graincraft", "made-up" })
            await Assert.ThrowsAsync<ValidationException>(() => h.Service.AddRecordAsync(
                new CreateFieldProgramRecordRequest { SeasonId = season.Id, ProgramKey = key, Data = StoryCorn }, default));
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

    // ── Locking (by confirming) ─────────────────────────────────────────────

    /// <summary>Confirms the field at 200 bu/ac with one 1,000 bu delivery.</summary>
    private static async Task<FieldProgramRecordResponse> Confirmed(Harness h, FieldProgramRecordResponse record)
    {
        var id = int.Parse(record.Id);
        h.CtrmTickets.Add(Delivery("2026-10-05", 56_000));
        var key = (await h.Tickets.ForRecordAsync(id, default)).Tickets[0].TicketKey;
        return await h.Service.ConfirmAsync(id, new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = NoTillPasses() }, default);
    }

    [Fact]
    public async Task Confirm_FreezesWithTheServersCalculator_AndStampsTheVersionAndUser()
    {
        var h = New();
        var (_, record) = await CornField(h);

        var locked = await Confirmed(h, record);

        Assert.Equal("Locked", locked.Status);
        var frozen = locked.Frozen!.Value;
        // Story County corn, 200 bu actual: the golden-case CI in FdCicServiceTests.
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
    public async Task ALockedRecord_CantBeEdited_NorItsSeasonChangedOrRemoved_AndRemovingItKeepsIt()
    {
        var h = New();
        var (season, record) = await CornField(h);
        await Confirmed(h, record);
        var seasonId = int.Parse(season.Id);

        await Assert.ThrowsAsync<BusinessException>(() => h.Service.UpdateRecordAsync(int.Parse(record.Id), new UpdateFieldProgramRecordRequest { Data = StoryCorn }, default));
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.UpdateSeasonAsync(seasonId, new UpdateFieldSeasonRequest { Acres = 10 }, default));
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.RemoveSeasonAsync(seasonId, default));
        await h.Service.RemoveRecordAsync(int.Parse(record.Id), default);

        Assert.Single((await h.Service.LoadAsync(Tobin, default)).Records);
    }

    // ── Reopening ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Reopen_KeepsTheConfirmedCiAndItsEstimateInTheHistory()
    {
        var h = New();
        var (_, record) = await CornField(h);
        await Confirmed(h, record);

        var reopened = await h.Service.ReopenAsync(int.Parse(record.Id), "  tickets were missing ", default);

        Assert.Equal("Ready", reopened.Status);
        Assert.Null(reopened.Frozen);
        Assert.Null(reopened.Official);
        var history = reopened.Reopened!.Value[0];
        Assert.Equal("tickets were missing", history.GetProperty("reason").GetString());
        Assert.Equal(3070.75, history.GetProperty("frozen").GetProperty("score").GetProperty("value").GetDouble(), 2);
        Assert.Equal("Documented", history.GetProperty("official").GetProperty("status").GetString());
    }

    [Fact]
    public async Task Reopen_NeedsAReason_AndOnlyAConfirmedCiCanBeReopened()
    {
        var h = New();
        var (_, record) = await CornField(h);

        var notConfirmed = await Assert.ThrowsAsync<BusinessException>(() => h.Service.ReopenAsync(int.Parse(record.Id), "fix", default));
        Assert.Equal("FIELD_PLAN_NOT_LOCKED", notConfirmed.ErrorCode);

        await Confirmed(h, record);
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.ReopenAsync(int.Parse(record.Id), "  ", default));
        Assert.Equal("Ready", (await h.Service.ReopenAsync(int.Parse(record.Id), "fix", default)).Status);
    }

    // ── Tickets for the 45Z review ──────────────────────────────────────────

    [Fact]
    public async Task Tickets_AreTheSplitsDeliveriesOfTheCrop_InTheCropYear_SettledOrNot()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.CtrmTickets.AddRange(
        [
            Delivery("2026-10-05", 56_000),                                       // 1,000 bu, in the window
            Delivery("2026-11-02", 28_000, settled: new DateTime(2026, 11, 20)),   // settled: still shown
            Delivery("2026-10-06", 56_000, split: "TATOB44"),                      // another split
            Delivery("2026-10-07", 60_000, product: "YSB"),                        // another crop
            Delivery("2026-07-15", 56_000),                                       // last crop year's window
            Delivery("2027-08-01", 56_000),                                       // next crop year's window
        ]);

        var found = await h.Tickets.ForRecordAsync(int.Parse(record.Id), default);

        Assert.Equal(("corn", "2026-08-01", "2027-07-31"), (found.CropGroup, found.WindowFrom, found.WindowTo));
        Assert.Equal(new[] { "2026-10-05", "2026-11-02" }, found.Tickets.Select(t => t.BlDate));
        Assert.Equal(new decimal?[] { 1000m, 500m }, found.Tickets.Select(t => t.NetBushels));
        Assert.Equal(new[] { false, true }, found.Tickets.Select(t => t.Settled));
        Assert.All(found.Tickets, t => Assert.Equal("window", t.CropYearMatch));
        Assert.Equal("Pratt, KS (PRA)", found.Tickets[0].Location);
    }

    [Fact]
    public async Task Tickets_AreSettledByTheirFinalSettledDate_OrExactlyAFinalSettledStatus()
    {
        var h = New();
        var (_, record) = await CornField(h);
        var statusOnly = Delivery("2026-10-05", 56_000);
        statusOnly.TicketStatusDescription = "final settled ";
        var unsettled = Delivery("2026-10-06", 56_000);
        unsettled.TicketStatusDescription = "Unsettled";
        var dateOnly = Delivery("2026-10-07", 56_000);
        dateOnly.FinalSettledDate = new DateTime(2026, 11, 1);
        h.CtrmTickets.AddRange([statusOnly, unsettled, dateOnly]);

        var found = await h.Tickets.ForRecordAsync(int.Parse(record.Id), default);

        Assert.Equal(new[] { true, false, true }, found.Tickets.Select(t => t.Settled));
    }

    [Fact]
    public async Task AddSeason_ReadsTheCropFromTheRowsCommodity_NotOnlyItsLabel()
    {
        var h = New();
        h.Db.PlantingIntentions.Add(new PlantingIntention { Id = 999, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2026, Crop = "YC", Type = "Dryland", Acres = 50, CreatedBy = "x" });
        h.Db.SaveChanges();
        await CornField(h);

        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.AddSeasonAsync(
            new CreateFieldSeasonRequest { FieldKey = "TATOB43", PlantingIntentionId = 999, Year = 2026, CropLabel = "Back 40", Acres = 10 }, default));

        Assert.Equal("FIELD_PLAN_FIELD_ON_ROW", ex.ErrorCode);
    }

    [Fact]
    public async Task Tickets_OutsideTheCropYear_AreOfferedToAdd_AndConfirmKeepsThemAsAdded()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.CtrmTickets.AddRange([Delivery("2026-10-05", 56_000), Delivery("2026-07-15", 112_000), Delivery("2026-10-06", 60_000, product: "YSB")]);

        var found = await h.Tickets.ForRecordAsync(int.Parse(record.Id), default);
        var early = Assert.Single(found.Others);
        Assert.Equal(("other", "BL date outside 8/1/26–7/31/27"), (early.CropYearMatch, early.Note));

        var confirmed = await h.Service.ConfirmAsync(int.Parse(record.Id), new ConfirmFieldProgramRecordRequest
        {
            ActualYield = 200, TicketKeys = [found.Tickets[0].TicketKey, early.TicketKey], ReviewedWithProducer = true, TDiscPasses = NoTillPasses(),
        }, default);

        var tickets = confirmed.Official!.Value.GetProperty("tickets");
        Assert.Equal(new[] { "window", "added" }, tickets.EnumerateArray().Select(t => t.GetProperty("cropYearMatch").GetString()));
        Assert.Equal(3000m, confirmed.Official.Value.GetProperty("bushels").GetDecimal());
    }

    [Fact]
    public async Task Tickets_AlreadyInAnotherYearsConfirmedCi_AreMarked_AndCantBeCountedAgain()
    {
        var h = New();
        h.Db.PlantingIntentions.Add(new PlantingIntention { Id = 998, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2025, Crop = "YC", Acres = 100, CreatedBy = "x" });
        h.Db.SaveChanges();
        var (_, record) = await CornField(h);
        var lastYear = await h.Service.AddSeasonAsync(new CreateFieldSeasonRequest { FieldKey = "TATOB43", PlantingIntentionId = 998, Year = 2025, CropLabel = "Corn", Acres = 120 }, default);
        var lastYearRecord = await h.Service.AddRecordAsync(new CreateFieldProgramRecordRequest { SeasonId = lastYear.Id, ProgramKey = FieldPlanPrograms.FdCic, Data = StoryCorn }, default);
        h.CtrmTickets.Add(Delivery("2026-07-15", 56_000)); // in 2025's window
        var lastYearKey = (await h.Tickets.ForRecordAsync(int.Parse(lastYearRecord.Id), default)).Tickets.Single().TicketKey;
        await h.Service.ConfirmAsync(int.Parse(lastYearRecord.Id), new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [lastYearKey], ReviewedWithProducer = true, TDiscPasses = NoTillPasses() }, default);

        var other = Assert.Single((await h.Tickets.ForRecordAsync(int.Parse(record.Id), default)).Others);
        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.ConfirmAsync(int.Parse(record.Id),
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [other.TicketKey], ReviewedWithProducer = true, TDiscPasses = NoTillPasses() }, default));

        Assert.Equal(2025, other.ConfirmedFor);
        Assert.Equal("FIELD_PLAN_TICKET_ALREADY_COUNTED", ex.ErrorCode);
    }

    [Fact]
    public async Task ACountedTicket_StaysCounted_WhenCtrmCorrectsItsBlDate_AndIsFreedByUnlocking()
    {
        var h = New();
        h.Db.PlantingIntentions.Add(new PlantingIntention { Id = 998, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2025, Crop = "YC", Acres = 100, CreatedBy = "x" });
        h.Db.SaveChanges();
        var (_, record) = await CornField(h);
        var lastYear = await h.Service.AddSeasonAsync(new CreateFieldSeasonRequest { FieldKey = "TATOB43", PlantingIntentionId = 998, Year = 2025, CropLabel = "Corn", Acres = 120 }, default);
        var lastYearRecord = await h.Service.AddRecordAsync(new CreateFieldProgramRecordRequest { SeasonId = lastYear.Id, ProgramKey = FieldPlanPrograms.FdCic, Data = StoryCorn }, default);
        var delivered = Delivery("2026-07-15", 56_000);
        h.CtrmTickets.Add(delivered);
        var key = (await h.Tickets.ForRecordAsync(int.Parse(lastYearRecord.Id), default)).Tickets.Single().TicketKey;
        await h.Service.ConfirmAsync(int.Parse(lastYearRecord.Id), new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = NoTillPasses() }, default);

        // CTRM corrects the BL date into 2026's window: a new key, the same ticket number.
        var corrected = Delivery("2026-08-03", 56_000);
        corrected.TicketNumber = delivered.TicketNumber;
        h.CtrmTickets.Clear();
        h.CtrmTickets.Add(corrected);
        Assert.Equal(2025, (await h.Tickets.ForRecordAsync(int.Parse(record.Id), default)).Tickets.Single().ConfirmedFor);

        await h.Service.ReopenAsync(int.Parse(lastYearRecord.Id), "ticket belongs to 2026", default);
        Assert.Null((await h.Tickets.ForRecordAsync(int.Parse(record.Id), default)).Tickets.Single().ConfirmedFor);
    }

    [Fact]
    public async Task Tickets_WithoutAConversion_HaveNoBushelFigure_NeverAStandardWeight()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.CtrmTickets.Add(Delivery("2026-10-05", 56_000, product: "YCO")); // corn, but ODS has no conversion for it

        var ticket = (await h.Tickets.ForRecordAsync(int.Parse(record.Id), default)).Tickets.Single();

        Assert.Null(ticket.NetBushels);
    }

    [Fact]
    public void TheShippedTicketWindow_IsAug1ToJul31_ForEveryCrop()
    {
        // Decided 2026-10-30: one window for every crop, canola included; a ticket outside it is added in the review.
        var settings = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(RepoRoot(), "api", "GrainOriginatorPortal.Api", "appsettings.json")).Build();
        var tickets = new FieldTicketService(Mock.Of<IFieldPlanRepository>(), Mock.Of<IFieldTicketReader>(), Mock.Of<ICommodityRepository>(), settings);

        foreach (var crop in FieldPlanCropGroups.Codes.Keys)
            Assert.Equal((new DateOnly(2026, 8, 1), new DateOnly(2027, 7, 31)), tickets.Window(crop, 2026));
    }

    [Fact]
    public async Task Tickets_OnTheWindowsFirstAndLastDays_AreIncluded()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.CtrmTickets.AddRange([Delivery("2026-07-31", 56_000), Delivery("2026-08-01", 56_000), Delivery("2027-07-31", 56_000), Delivery("2027-08-01", 56_000)]);

        var found = await h.Tickets.ForRecordAsync(int.Parse(record.Id), default);

        Assert.Equal(new[] { "2026-08-01", "2027-07-31" }, found.Tickets.Select(t => t.BlDate));
    }

    [Fact]
    public async Task Confirm_RefusesATicketWithNoBushelFigure()
    {
        var h = New();
        var (_, record) = await CornField(h);
        var unweighed = Delivery("2026-10-05", 0);
        unweighed.AppliedDockQuantity = null;
        h.CtrmTickets.Add(unweighed);
        var key = (await h.Tickets.ForRecordAsync(int.Parse(record.Id), default)).Tickets.Single().TicketKey;

        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.ConfirmAsync(int.Parse(record.Id),
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = NoTillPasses() }, default));

        Assert.Equal("FIELD_PLAN_TICKET_NO_BUSHELS", ex.ErrorCode);
    }

    [Fact]
    public void TicketWindow_RefusesFebruary29()
    {
        var settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["FieldPlan:TicketWindow:corn:To"] = "02-29" }).Build();
        var tickets = new FieldTicketService(Mock.Of<IFieldPlanRepository>(), Mock.Of<IFieldTicketReader>(), Mock.Of<ICommodityRepository>(), settings);

        Assert.Throws<InvalidOperationException>(() => tickets.Window("corn", 2026));
    }

    [Fact]
    public async Task Tickets_OnAContract_TakeTheContractsCropYear_OverTheDate()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.ContractYears["P12345"] = 2026;
        h.ContractYears["P99999"] = 2025;
        h.CtrmTickets.AddRange(
        [
            Delivery("2027-09-10", 56_000, contract: "p12345 "),  // outside the window, but a 2026 contract
            Delivery("2026-10-05", 56_000, contract: "P99999"),   // in the window, but a 2025 contract
            Delivery("2026-10-06", 56_000, contract: "U555"),     // unapplied, no contract year: the window decides
        ]);

        var found = await h.Tickets.ForRecordAsync(int.Parse(record.Id), default);

        Assert.Equal(new[] { ("2026-10-06", "window"), ("2027-09-10", "contract") }, found.Tickets.Select(t => (t.BlDate!, t.CropYearMatch)));
    }

    [Fact]
    public void TicketWindow_IsConfigurablePerCrop_AndRunsIntoTheNextYear()
    {
        var h = New();

        Assert.Equal((new DateOnly(2026, 8, 1), new DateOnly(2027, 7, 31)), h.Tickets.Window("corn", 2026));
        Assert.Equal((new DateOnly(2026, 9, 15), new DateOnly(2027, 7, 31)), h.Tickets.Window("soybeans", 2026));
    }

    [Fact]
    public void CropGroups_MatchTheClientsList_AndReadLabels()
    {
        // Must equal CROP_CODE_MAP in client/src/app/shared/utils/crop-group-match.ts for these crops.
        var client = File.ReadAllText(Path.Combine(RepoRoot(), "client", "src", "app", "shared", "utils", "crop-group-match.ts"));
        foreach (var (group, codes) in FieldPlanCropGroups.Codes)
        {
            var line = client.Split('\n').Single(l => l.TrimStart().StartsWith($"{group}:"));
            Assert.Equal(codes, System.Text.RegularExpressions.Regex.Matches(line, "'([^']+)'").Select(m => m.Groups[1].Value));
        }
        Assert.Equal("corn", FieldPlanCropGroups.For("YCNG"));
        Assert.Equal("soybeans", FieldPlanCropGroups.For("XYZ", "Soybeans"));
        Assert.Equal("corn", FieldPlanCropGroups.ForLabel("Irrigated Corn"));
        Assert.Equal("sorghum", FieldPlanCropGroups.ForLabel("Milo"));
        Assert.Null(FieldPlanCropGroups.ForLabel("Popcorn"));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "client"))) dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("repo root");
    }

    // ── Confirming after harvest ────────────────────────────────────────────

    [Fact]
    public async Task Confirm_RescoresWithTheGivenYield_AndKeepsCtrmsBushelsAndTickets()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.CtrmTickets.AddRange([Delivery("2026-10-05", 56_000 * 12), Delivery("2026-10-06", 56_000 * 12), Delivery("2026-10-07", 56_000)]);
        var found = await h.Tickets.ForRecordAsync(int.Parse(record.Id), default);

        var confirmed = await h.Service.ConfirmAsync(int.Parse(record.Id), new ConfirmFieldProgramRecordRequest
        {
            ActualYield = 200, TicketKeys = [found.Tickets[0].TicketKey, found.Tickets[1].TicketKey], ReviewedWithProducer = true, TDiscPasses = NoTillPasses(),
        }, default);

        var official = confirmed.Official!.Value;
        Assert.Equal("Locked", confirmed.Status);
        Assert.Equal("Documented", official.GetProperty("status").GetString());
        // Story County corn at 200 bu: the golden-case CI.
        Assert.Equal(3070.75, official.GetProperty("score").GetProperty("value").GetDouble(), 2);
        Assert.Equal(24_000m, official.GetProperty("bushels").GetDecimal());
        Assert.Equal(2, official.GetProperty("tickets").GetArrayLength());
        Assert.Equal(User, official.GetProperty("documentedBy").GetString());
        Assert.Equal("Tess Tester", official.GetProperty("documentedByName").GetString());
        Assert.Equal(200, confirmed.Data.GetProperty("actualYield").GetDouble());
    }

    [Fact]
    public async Task Confirm_UsesTheYieldGiven_NotTheOneTyped()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.CtrmTickets.Add(Delivery("2026-10-05", 56_000 * 20));
        var key = (await h.Tickets.ForRecordAsync(int.Parse(record.Id), default)).Tickets[0].TicketKey;

        var confirmed = await h.Service.ConfirmAsync(int.Parse(record.Id), new ConfirmFieldProgramRecordRequest
        {
            ActualYield = 166.67, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = NoTillPasses(),
        }, default);

        var atTwoHundred = 3070.75;
        Assert.NotEqual(atTwoHundred, confirmed.Official!.Value.GetProperty("score").GetProperty("value").GetDouble(), 0);
        Assert.Equal(166.67, confirmed.Official.Value.GetProperty("actualYield").GetDouble());
    }

    [Fact]
    public async Task Confirm_RefusesUnknownTickets_NoTickets_AnUntickedReview_AndASecondConfirm()
    {
        var h = New();
        var (_, record) = await CornField(h);
        h.CtrmTickets.Add(Delivery("2026-10-05", 56_000));
        var key = (await h.Tickets.ForRecordAsync(int.Parse(record.Id), default)).Tickets[0].TicketKey;
        var id = int.Parse(record.Id);
        ConfirmFieldProgramRecordRequest Request(params string[] keys) => new() { ActualYield = 200, TicketKeys = [.. keys], ReviewedWithProducer = true, TDiscPasses = NoTillPasses() };

        await Assert.ThrowsAsync<BusinessException>(() => h.Service.ConfirmAsync(id, Request(key, "999999"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.ConfirmAsync(id, Request(), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.ConfirmAsync(id, Request(key) with { ReviewedWithProducer = false }, default));
        await h.Service.ConfirmAsync(id, Request(key), default);
        var again = await Assert.ThrowsAsync<BusinessException>(() => h.Service.ConfirmAsync(id, Request(key), default));
        Assert.Equal("FIELD_PLAN_ALREADY_CONFIRMED", again.ErrorCode);
    }

    // ── T-DISC at confirm ───────────────────────────────────────────────────

    private static JsonElement CornWith(string tillage) => Json($$"""
        { "expectedYield": 190, "actualYield": 200, "syntheticN": 180, "niFraction": 0.5,
          "coverCrop": "None", "tillage": "{{tillage}}", "manure": [] }
        """);

    private static async Task<(int Id, string Key)> FieldWithATicket(Harness h, string tillage)
    {
        var (_, record) = await CornField(h, data: CornWith(tillage));
        h.CtrmTickets.Add(Delivery("2026-10-05", 56_000));
        var id = int.Parse(record.Id);
        return (id, (await h.Tickets.ForRecordAsync(id, default)).Tickets[0].TicketKey);
    }

    [Theory]
    [InlineData("NoTill")]
    [InlineData("ReducedTill")]
    public async Task Confirm_NoTillOrReducedTill_NeedsTDiscPasses(string tillage)
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, tillage);

        var ex = await Assert.ThrowsAsync<BusinessException>(() => h.Service.ConfirmAsync(id,
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true }, default));

        Assert.Equal("FIELD_PLAN_TDISC_REQUIRED", ex.ErrorCode);
    }

    [Fact]
    public async Task Confirm_RefusesAnEmptyPass_AsAValidationError()
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, "NoTill");

        var ex = await Assert.ThrowsAsync<ValidationException>(() => h.Service.ConfirmAsync(id,
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = [null!] }, default));

        Assert.Contains("empty", ex.Message);
    }

    [Fact]
    public async Task Confirm_NoneOfTheAbove_NeedsNoTDisc_AndIgnoresOneSent()
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, "NoneOfTheAbove");

        var confirmed = await h.Service.ConfirmAsync(id,
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = NoTillPasses() }, default);

        Assert.Equal(JsonValueKind.Null, confirmed.Official!.Value.GetProperty("tDisc").ValueKind);
        Assert.Equal("NoneOfTheAbove", confirmed.Data.GetProperty("tillage").GetString());
        Assert.Equal(JsonValueKind.Null, confirmed.Data.GetProperty("tDiscPasses").ValueKind);
    }

    [Theory]
    [InlineData("NoTill", "NT", "NoTill")]
    [InlineData("NoTill", "RT", "ReducedTill")]
    [InlineData("NoTill", "CT", "NoneOfTheAbove")]
    [InlineData("ReducedTill", "NT", "ReducedTill")] // never steps up to a practice not selected
    [InlineData("ReducedTill", "CT", "NoneOfTheAbove")]
    public void TDisc_SupportedTillage_OnlyStepsDown(string selected, string designation, string expected) =>
        Assert.Equal(expected, FieldPlanTDisc.SupportedTillage(selected, designation));

    [Fact]
    public async Task Confirm_PassesThatDontSupportNoTill_RescoreAtReducedTill_AndRecordTheWorksheet()
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, "NoTill");

        var confirmed = await h.Service.ConfirmAsync(id,
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = ReducedTillPasses() }, default);

        var official = confirmed.Official!.Value;
        var tDisc = official.GetProperty("tDisc");
        Assert.Equal(0.1422, tDisc.GetProperty("rating").GetDouble(), 9);
        Assert.Equal("Reduced till", tDisc.GetProperty("designation").GetString());
        Assert.Equal("No till", tDisc.GetProperty("estimatedTillage").GetString());
        Assert.Equal("Reduced till", tDisc.GetProperty("confirmedTillage").GetString());
        Assert.Equal("USDA T-DISC v1.1.1", tDisc.GetProperty("version").GetString());
        // The worksheet: passes sorted by depth (harvest is 0 cm, then the coil-tine harrow), each with the intensity it adds.
        var passes = tDisc.GetProperty("passes").EnumerateArray().ToList();
        Assert.Equal(["HARVEST, GRAIN", "HARROW, COILED TINES", "CULTIVATOR, FIELD"], passes.Select(p => p.GetProperty("implement").GetString()));
        Assert.Equal(0.6, passes[1].GetProperty("tillageIntensity").GetDouble(), 9);
        Assert.Equal(0.39 * (10 - 0.6), passes[2].GetProperty("tillageIntensity").GetDouble(), 9);
        var fieldPrep = tDisc.GetProperty("windows").EnumerateArray().Single(w => w.GetProperty("key").GetString() == "Field_Preparation");
        Assert.Equal("RT", fieldPrep.GetProperty("designation").GetString());

        Assert.Equal("ReducedTill", confirmed.Data.GetProperty("tillage").GetString());
        Assert.Equal(3, confirmed.Data.GetProperty("tDiscPasses").GetArrayLength());
        var inputs = confirmed.Frozen!.Value.GetProperty("inputs");
        Assert.Equal("Reduced till", inputs.GetProperty("tillage").GetString());
        Assert.Equal(0.1422, inputs.GetProperty("tDiscRating").GetDouble(), 9);
        // Story County corn at 200 bu is 3070.75 at no-till; reduced till scores differently.
        Assert.NotEqual(3070.75, official.GetProperty("score").GetProperty("value").GetDouble(), 2);
        Assert.True(official.GetProperty("recordkeepingAcknowledged").GetBoolean());
    }

    [Fact]
    public async Task Reopen_AfterAStepDown_PutsBackTheEstimatedTillage_AndKeepsThePasses()
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, "NoTill");
        await h.Service.ConfirmAsync(id,
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = ReducedTillPasses() }, default);

        var reopened = await h.Service.ReopenAsync(id, "a pass was entered wrong", default);

        Assert.Equal("NoTill", reopened.Data.GetProperty("tillage").GetString());
        Assert.Equal(3, reopened.Data.GetProperty("tDiscPasses").GetArrayLength());
        Assert.Null(reopened.Official);
    }

    [Fact]
    public async Task Confirm_PassesRatingExactly0075_KeepNoTill()
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, "NoTill");

        var confirmed = await h.Service.ConfirmAsync(id, new ConfirmFieldProgramRecordRequest
        {
            ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true,
            TDiscPasses = [Pass("Planting", "CULTIVATOR, ROTARY HOE"), Pass("Harvest", "HARVEST, GRAIN")],
        }, default);

        Assert.Equal("No till", confirmed.Official!.Value.GetProperty("tDisc").GetProperty("confirmedTillage").GetString());
        Assert.Equal(3070.75, confirmed.Official.Value.GetProperty("score").GetProperty("value").GetDouble(), 2);
    }

    [Fact]
    public async Task Confirm_IgnoresARatingSavedInTheData_AndUsesItsOwn()
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, "NoTill");
        await h.Service.UpdateRecordAsync(id, new UpdateFieldProgramRecordRequest { Data = Json("""
            { "expectedYield": 190, "actualYield": 200, "syntheticN": 180, "niFraction": 0.5,
              "coverCrop": "None", "tillage": "NoTill", "manure": [], "tDiscRating": 0.01 }
            """) }, default);

        var confirmed = await h.Service.ConfirmAsync(id,
            new ConfirmFieldProgramRecordRequest { ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = ReducedTillPasses() }, default);

        Assert.Equal(0.1422, confirmed.Data.GetProperty("tDiscRating").GetDouble(), 9);
        Assert.Equal("ReducedTill", confirmed.Data.GetProperty("tillage").GetString());
    }

    [Theory]
    [InlineData("Harvest", "PLOW, CHISEL")] // not a harvest implement
    [InlineData("Planting", "SPADE, GARDEN")] // not a T-DISC implement
    [InlineData("Sometime", "PLANTER, REGULAR")] // not a window
    public async Task Confirm_RefusesAPassTDiscDoesntAllow(string window, string implement)
    {
        var h = New();
        var (id, key) = await FieldWithATicket(h, "NoTill");

        await Assert.ThrowsAsync<ValidationException>(() => h.Service.ConfirmAsync(id, new ConfirmFieldProgramRecordRequest
        {
            ActualYield = 200, TicketKeys = [key], ReviewedWithProducer = true, TDiscPasses = [Pass(window, implement)],
        }, default));
    }

    [Fact]
    public async Task SavingData_RefusesATDiscRatingOutside0To1_OrMoreThan20Passes()
    {
        var h = New();
        var (_, record) = await CornField(h);

        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UpdateRecordAsync(int.Parse(record.Id),
            new UpdateFieldProgramRecordRequest { Data = Json("""{ "tillage": "NoTill", "coverCrop": "None", "niFraction": 0, "manure": [], "tDiscRating": 1.5 }""") }, default));
        var tooMany = string.Join(",", Enumerable.Repeat("""{ "window": "Harvest", "implement": "HARVEST, GRAIN" }""", 21));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UpdateRecordAsync(int.Parse(record.Id),
            new UpdateFieldProgramRecordRequest { Data = Json($$"""{ "tillage": "NoTill", "coverCrop": "None", "niFraction": 0, "manure": [], "tDiscPasses": [{{tooMany}}] }""") }, default));
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
