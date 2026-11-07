// System namespaces
using System.Text;
using System.Text.Json.Nodes;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Repositories;
using GrainOriginatorPortal.Api.Platform.DocStore;

namespace GrainOriginatorPortal.Api.Tests.Services.FieldPlan;

/// <summary>
/// 45Z documents in Doc Store: the server sets the metadata from its own rows, saves a confirmed field's report
/// once per confirmation, accepts only PDF/PNG/JPEG by content, and never hands one producer's document to
/// another producer's route. Runs against EF InMemory and the in-memory Doc Store stand-in.
/// </summary>
public class FieldPlanDocumentServiceTests
{
    private const long Tobin = 260843, Other = 999;
    private const int ConfirmedRecord = 1, DraftRecord = 2;

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.7\n% test\n");
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
    private static readonly byte[] Html = Encoding.ASCII.GetBytes("<html><script>alert(1)</script></html>");

    private sealed record Harness(ApplicationDbContext Db, FieldPlanDocumentService Service, InMemoryDocStoreClient DocStore);

    private static Harness New()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"field-plan-docs-{Guid.NewGuid()}").Options);
        db.Customers.Add(new Customer { Id = Tobin, Name = "T-A TOBIN FARMS LC", ScoularId = "TATOBIN" });
        db.Customers.Add(new Customer { Id = Other, Name = "Other Farm", ScoularId = "OTHER" });
        db.PlantingIntentions.Add(new PlantingIntention { Id = 10, CustomerId = Tobin, TradeUnit = "2190", PlantingYear = 2026, Crop = "YC", Acres = 500, CreatedBy = "x" });
        var field = new ProducerField { Id = 1, CustomerId = Tobin, SplitId = "TATOB43", Name = "JARBOE WEST", SplitPercent = 100m, CreatedBy = "x" };
        var season = new ProducerFieldSeason { Id = 1, ProducerFieldId = 1, PlantingIntentionId = 10, CropYear = 2026, CropLabel = "Corn", CreatedBy = "x", Field = field };
        db.ProducerFields.Add(field);
        db.ProducerFieldSeasons.Add(season);
        db.FieldProgramRecords.Add(new FieldProgramRecord
        {
            Id = ConfirmedRecord, ProducerFieldSeasonId = 1, ProgramKey = FieldPlanPrograms.FdCic, Status = "Locked", CreatedBy = "x",
            Official = """{"status":"Documented","documentedAt":"2026-11-04T15:00:00.0000000Z"}""",
        });
        db.FieldProgramRecords.Add(new FieldProgramRecord { Id = DraftRecord, ProducerFieldSeasonId = 1, ProgramKey = "other", CreatedBy = "x" });
        db.SaveChanges();

        var context = new Mock<IRequestContextService>();
        context.Setup(c => c.GetCurrentUser()).Returns("tester@scoular.com");
        context.Setup(c => c.GetCurrentUserDisplayName()).Returns("Tess Tester");
        var docStore = new InMemoryDocStoreClient();
        var service = new FieldPlanDocumentService(docStore, new FieldPlanRepository(db), context.Object,
            Options.Create(new DocStoreOptions { MaxFileBytes = 1024 }), NullLogger<FieldPlanDocumentService>.Instance);
        return new Harness(db, service, docStore);
    }

    private static IFormFile File(byte[] content, string name) =>
        new FormFile(new MemoryStream(content), 0, content.Length, "file", name);

    [Fact]
    public async Task SaveReport_TagsTheReportFromTheServersRows_AndKeepsItsIdOnTheOfficialResult()
    {
        var h = New();

        var saved = await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "45Z-Biofuel-Feedstock-Report_TATOBIN_CI-2026-TATOB43_20261104.pdf"), default);

        Assert.Equal("FeedstockReport", saved.DocumentType);
        Assert.Equal(2026, saved.CropYear);
        Assert.Equal("TATOB43", saved.SplitId);
        Assert.Equal("YC", saved.Commodity);
        Assert.Equal("Tess Tester", saved.UploadedBy);
        // Filed under the 45Z category, which the app's managed identity is granted in each environment.
        Assert.Equal("Sustainability-45z", h.DocStore.Categories[saved.Id]);
        var metadata = h.DocStore.Metadata[saved.Id];
        Assert.Equal("260843", metadata[FieldPlanDocumentMetadata.CustomerId]);
        Assert.Equal("TATOBIN", metadata[FieldPlanDocumentMetadata.ProducerCode]);
        Assert.Equal("TATOB43", metadata[FieldPlanDocumentMetadata.SplitId]);
        Assert.Equal("2026-11-04T15:00:00.0000000Z", metadata[FieldPlanDocumentMetadata.ConfirmedAt]);
        var row = await h.Db.FieldPlanDocuments.SingleAsync();
        Assert.Equal((saved.Id, Tobin, 2026, (int?)ConfirmedRecord, "tester@scoular.com"), (row.DocStoreId, row.CustomerId, row.CropYear, row.FieldProgramRecordId, row.CreatedBy));
        var official = JsonNode.Parse((await h.Db.FieldProgramRecords.FindAsync(ConfirmedRecord))!.Official!)!;
        Assert.Equal(saved.Id, official["reportDocumentId"]!.GetValue<string>());
    }

    [Fact]
    public async Task SaveReport_ASecondSaveOfTheSameConfirmation_ReturnsTheFirstDocument()
    {
        var h = New();

        var first = await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "report.pdf"), default);
        var second = await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "report.pdf"), default);

        Assert.Equal(first.Id, second.Id);
        Assert.Single(await h.Service.ListAsync(Tobin, 2026, default));
    }

    [Fact]
    public async Task SaveReport_RefusesAnUnconfirmedField_AndAnythingButAPdf()
    {
        var h = New();

        await Assert.ThrowsAsync<BusinessException>(() => h.Service.SaveReportAsync(DraftRecord, File(Pdf, "r.pdf"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.SaveReportAsync(ConfirmedRecord, File(Png, "r.pdf"), default));
        await Assert.ThrowsAsync<NotFoundException>(() => h.Service.SaveReportAsync(404, File(Pdf, "r.pdf"), default));
    }

    [Fact]
    public async Task Upload_KeepsAnAttestationForTheProducerAndYear_NamedForItsContents()
    {
        var h = New();

        var doc = await h.Service.UploadAsync(Tobin, 2026, "producerattestation", File(Png, @"C:\scans\..\Tobin attestation<1>.pdf"), default);

        Assert.Equal("ProducerAttestation", doc.DocumentType);
        Assert.Equal("image/png", doc.ContentType);
        Assert.Equal("Tobin attestation_1_.png", doc.FileName);
        Assert.Null(doc.SplitId);
    }

    [Theory]
    [InlineData("FeedstockReport")]
    [InlineData("Invoice")]
    [InlineData("")]
    public async Task Upload_RefusesATypeAnOriginatorCantUpload(string type)
    {
        var h = New();
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UploadAsync(Tobin, 2026, type, File(Pdf, "a.pdf"), default));
    }

    [Fact]
    public async Task Upload_RefusesHtmlNamedPdf_AnEmptyFile_ATooLargeFile_AnUnknownProducer_AndABadYear()
    {
        var h = New();

        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UploadAsync(Tobin, 2026, "Other", File(Html, "a.pdf"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UploadAsync(Tobin, 2026, "Other", File([], "a.pdf"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UploadAsync(Tobin, 2026, "Other", File([.. Pdf, .. new byte[2048]], "a.pdf"), default));
        await Assert.ThrowsAsync<NotFoundException>(() => h.Service.UploadAsync(12345, 2026, "Other", File(Pdf, "a.pdf"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.UploadAsync(Tobin, 1999, "Other", File(Pdf, "a.pdf"), default));
    }

    [Fact]
    public async Task List_ShowsOnlyThatProducersDocuments_ForTheYearAsked_AttestationsFirst()
    {
        var h = New();
        await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "report.pdf"), default);
        await h.Service.UploadAsync(Tobin, 2026, "ProducerAttestation", File(Pdf, "attestation.pdf"), default);
        await h.Service.UploadAsync(Tobin, 2025, "Other", File(Pdf, "last-year.pdf"), default);
        await h.Service.UploadAsync(Other, 2026, "Other", File(Pdf, "someone-else.pdf"), default);

        var docs = await h.Service.ListAsync(Tobin, 2026, default);

        Assert.Equal(["ProducerAttestation", "FeedstockReport"], docs.Select(d => d.DocumentType));
        Assert.Equal(3, (await h.Service.ListAsync(Tobin, null, default)).Count);
    }

    [Fact]
    public async Task Download_AnotherProducersDocument_IsNotFound()
    {
        var h = New();
        var theirs = await h.Service.UploadAsync(Other, 2026, "Other", File(Pdf, "theirs.pdf"), default);

        await Assert.ThrowsAsync<NotFoundException>(() => h.Service.DownloadAsync(Tobin, theirs.Id, default));
        var mine = await h.Service.DownloadAsync(Other, theirs.Id, default);
        Assert.Equal(("application/pdf", "theirs.pdf"), (mine.ContentType, mine.FileName));
    }

    // ── Mass Balance Ledger, overwrite and archive ──────────────────────────

    /// <summary>The ledger as the client sends it: a byte-order mark (so Excel reads UTF-8), the header, a row.</summary>
    private static readonly byte[] LedgerCsv = Encoding.UTF8.GetBytes((char)0xFEFF + FieldPlanDocumentService.LedgerHeader + "\r\n" +
        "TATOBIN,T-A TOBIN FARMS LC,TATOB43,South Field,CI-2026-TATOB43,2026,Sorghum,125,28794,4,1435.88,Reduced till,USDA FD-CIC v1.2,Hope Collins,2026-11-03T16:44:55.778Z\r\n");

    /// <summary>What unlocking and confirming again does to the record: a new official result, without the old document ids.</summary>
    private static async Task ReconfirmAsync(Harness h)
    {
        var record = (await h.Db.FieldProgramRecords.FindAsync(ConfirmedRecord))!;
        record.Official = """{"status":"Documented","documentedAt":"2026-11-05T15:00:00.0000000Z"}""";
        await h.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task SaveLedger_KeepsTheFieldsLedgerAsCsv_TaggedWithTheFieldAndYear_OncePerConfirmation()
    {
        var h = New();

        var ledger = await h.Service.SaveLedgerAsync(ConfirmedRecord, File(LedgerCsv, "45Z-Mass-Balance-Ledger_TATOBIN_2026_20261104.csv"), default);
        var again = await h.Service.SaveLedgerAsync(ConfirmedRecord, File(LedgerCsv, "45Z-Mass-Balance-Ledger_TATOBIN_2026_20261104.csv"), default);

        Assert.Equal(("MassBalanceLedger", "text/csv", "TATOB43", "JARBOE WEST", 2026, "Current"),
            (ledger.DocumentType, ledger.ContentType, ledger.SplitId, ledger.FieldName, ledger.CropYear, ledger.Status));
        Assert.Equal("45Z-Mass-Balance-Ledger_TATOBIN_2026_20261104.csv", ledger.FileName);
        Assert.Equal(ledger.Id, again.Id);
        Assert.Equal("JARBOE WEST", h.DocStore.Metadata[ledger.Id][FieldPlanDocumentMetadata.FieldName]);
        var official = JsonNode.Parse((await h.Db.FieldProgramRecords.FindAsync(ConfirmedRecord))!.Official!)!;
        Assert.Equal(ledger.Id, official["ledgerDocumentId"]!.GetValue<string>());
    }

    [Fact]
    public async Task SaveLedger_RefusesAnythingButTheLedgerFile()
    {
        var h = New();

        await Assert.ThrowsAsync<ValidationException>(() => h.Service.SaveLedgerAsync(ConfirmedRecord, File(Pdf, "ledger.csv"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.SaveLedgerAsync(ConfirmedRecord, File(Encoding.UTF8.GetBytes("a,b\r\n1,2\r\n"), "ledger.csv"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.SaveLedgerAsync(ConfirmedRecord, File(Encoding.UTF8.GetBytes(FieldPlanDocumentService.LedgerHeader + "\r\n"), "ledger.csv"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.SaveLedgerAsync(ConfirmedRecord, File([.. Encoding.UTF8.GetBytes(FieldPlanDocumentService.LedgerHeader + "\r\n"), 0xC3, 0x28], "ledger.csv"), default));
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.SaveLedgerAsync(DraftRecord, File(LedgerCsv, "ledger.csv"), default));
        Assert.Empty(h.Db.FieldPlanDocuments);
    }

    [Theory]
    [InlineData("TATOBIN,=HYPERLINK(\"http://x\"),1", true)]
    [InlineData("TATOBIN,\"=1+1\",1", true)]
    [InlineData("TATOBIN,@SUM(A1),1", true)]
    [InlineData("TATOBIN,-cmd,1", true)]
    [InlineData("TATOBIN,'=guarded by the client,-12.5,1435.88,\"South, east\",", false)]
    [InlineData("TATOBIN,a=b,-0.5,\"say \"\"=hi\"\"\"", false)]
    public void HasFormula_FindsACellThatWouldRunInASpreadsheet(string row, bool formula) =>
        Assert.Equal(formula, FieldPlanDocumentService.HasFormula(FieldPlanDocumentService.LedgerHeader + "\r\n" + row + "\r\n"));

    [Fact]
    public async Task SaveLedger_RefusesALedgerWithAFormulaInIt()
    {
        var h = New();
        var bad = Encoding.UTF8.GetBytes(FieldPlanDocumentService.LedgerHeader + "\r\nTATOBIN,=HYPERLINK(\"http://x\",\"x\"),TATOB43\r\n");
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.SaveLedgerAsync(ConfirmedRecord, File(bad, "ledger.csv"), default));
    }

    [Fact]
    public async Task ConfirmingAgain_MarksTheFieldsPreviousReportAndLedgerOverwritten_ByTheNewOnes()
    {
        var h = New();
        var firstReport = await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "report.pdf"), default);
        var firstLedger = await h.Service.SaveLedgerAsync(ConfirmedRecord, File(LedgerCsv, "ledger.csv"), default);
        var attestation = await h.Service.UploadAsync(Tobin, 2026, "ProducerAttestation", File(Pdf, "attestation.pdf"), default);

        await ReconfirmAsync(h);
        var newReport = await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "report.pdf"), default);
        var newLedger = await h.Service.SaveLedgerAsync(ConfirmedRecord, File(LedgerCsv, "ledger.csv"), default);

        var docs = (await h.Service.ListAsync(Tobin, 2026, default)).ToDictionary(d => d.Id);
        Assert.Equal(5, docs.Count);
        Assert.Equal(("Overwritten", newReport.Id, "Tess Tester"), (docs[firstReport.Id].Status, docs[firstReport.Id].ReplacedById, docs[firstReport.Id].StatusChangedBy));
        Assert.NotNull(docs[firstReport.Id].StatusChangedAt);
        Assert.Equal(("Overwritten", newLedger.Id), (docs[firstLedger.Id].Status, docs[firstLedger.Id].ReplacedById));
        Assert.Equal(["Current", "Current", "Current"], new[] { newReport.Id, newLedger.Id, attestation.Id }.Select(id => docs[id].Status));
    }

    [Fact]
    public async Task Archive_SetsADocumentAsideWithTheReason_AndRestoreBringsItBack()
    {
        var h = New();
        var attestation = await h.Service.UploadAsync(Tobin, 2026, "ProducerAttestation", File(Pdf, "attestation.pdf"), default);

        var archived = await h.Service.ArchiveAsync(Tobin, attestation.Id, "  No longer relevant to 2026  ", default);

        Assert.Equal(("Archived", "No longer relevant to 2026", "Tess Tester"), (archived.Status, archived.StatusNote, archived.StatusChangedBy));
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.ArchiveAsync(Tobin, attestation.Id, null, default));
        await Assert.ThrowsAsync<NotFoundException>(() => h.Service.ArchiveAsync(Other, attestation.Id, null, default));
        var other = await h.Service.UploadAsync(Tobin, 2026, "Other", File(Pdf, "b.pdf"), default);
        await Assert.ThrowsAsync<ValidationException>(() => h.Service.ArchiveAsync(Tobin, other.Id, new string('x', 501), default));
        Assert.Equal("attestation.pdf", (await h.Service.DownloadAsync(Tobin, attestation.Id, default)).FileName);

        var restored = await h.Service.RestoreAsync(Tobin, attestation.Id, default);
        Assert.Equal(("Current", null), (restored.Status, restored.StatusNote));
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.RestoreAsync(Tobin, attestation.Id, default));
    }

    [Fact]
    public async Task Upload_ANewAttestation_ArchivesTheYearsCurrentOne_AndLeavesOtherYearsAndDocumentsAlone()
    {
        var h = New();
        var first = await h.Service.UploadAsync(Tobin, 2026, "ProducerAttestation", File(Pdf, "attestation.pdf"), default);
        var lastYear = await h.Service.UploadAsync(Tobin, 2025, "ProducerAttestation", File(Pdf, "attestation-2025.pdf"), default);
        var other = await h.Service.UploadAsync(Tobin, 2026, "Other", File(Pdf, "map.pdf"), default);
        var theirs = await h.Service.UploadAsync(Other, 2026, "ProducerAttestation", File(Pdf, "theirs.pdf"), default);

        var second = await h.Service.UploadAsync(Tobin, 2026, "ProducerAttestation", File(Pdf, "attestation-signed.pdf"), default);

        var docs = (await h.Service.ListAsync(Tobin, null, default)).ToDictionary(d => d.Id);
        Assert.Equal(("Archived", FieldPlanDocumentService.AttestationReplacedNote, second.Id, "Tess Tester"),
            (docs[first.Id].Status, docs[first.Id].StatusNote, docs[first.Id].ReplacedById, docs[first.Id].StatusChangedBy));
        Assert.Equal(["Current", "Current", "Current"], new[] { second.Id, lastYear.Id, other.Id }.Select(id => docs[id].Status));
        Assert.Equal("Current", (await h.Service.ListAsync(Other, 2026, default)).Single(d => d.Id == theirs.Id).Status);

        // The replaced one can't come back over the newer one; archive that first.
        await Assert.ThrowsAsync<BusinessException>(() => h.Service.RestoreAsync(Tobin, first.Id, default));
        await h.Service.ArchiveAsync(Tobin, second.Id, "Signed for the wrong year", default);
        var restored = await h.Service.RestoreAsync(Tobin, first.Id, default);
        Assert.Equal(("Current", null, null), (restored.Status, restored.StatusNote, restored.ReplacedById));
    }

    [Fact]
    public async Task Restore_AFieldsArchivedReport_IsRefusedWhileANewerOneIsCurrent()
    {
        var h = New();
        var first = await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "report.pdf"), default);
        await h.Service.ArchiveAsync(Tobin, first.Id, null, default);
        await ReconfirmAsync(h);
        var second = await h.Service.SaveReportAsync(ConfirmedRecord, File(Pdf, "report.pdf"), default);

        // The archived one stays archived (not overwritten), and can't come back over the newer one.
        Assert.Equal("Archived", (await h.Service.ListAsync(Tobin, 2026, default)).Single(d => d.Id == first.Id).Status);
        var refused = await Assert.ThrowsAsync<BusinessException>(() => h.Service.RestoreAsync(Tobin, first.Id, default));
        Assert.Contains("newer Biofuel Feedstock Report", refused.Message);

        await h.Service.ArchiveAsync(Tobin, second.Id, "Wrong acres", default);
        Assert.Equal("Current", (await h.Service.RestoreAsync(Tobin, first.Id, default)).Status);
    }

    [Fact]
    public async Task Disabled_UploadsAndDownloadsAre503sThatSayDocStoreIsntSetUp()
    {
        var off = new DisabledDocStoreClient();
        var ex = await Assert.ThrowsAsync<InfrastructureException>(() => off.UploadAsync(new DocStoreUpload(FieldPlanDocumentMetadata.Category, "a.pdf", "application/pdf", Pdf, new Dictionary<string, string>()), default));
        Assert.Equal(503, ex.HttpStatusCode);
        await Assert.ThrowsAsync<InfrastructureException>(() => off.DownloadAsync(Guid.NewGuid().ToString(), default));
    }
}
