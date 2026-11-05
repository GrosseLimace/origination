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
using GrainOriginatorPortal.Api.Services.DocStore;
using GrainOriginatorPortal.Api.Services.FieldPlan;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

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
        var metadata = h.DocStore.Metadata[saved.Id];
        Assert.Equal("260843", metadata[DocStoreMetadata.CustomerId]);
        Assert.Equal("TATOBIN", metadata[DocStoreMetadata.ProducerCode]);
        Assert.Equal("TATOB43", metadata[DocStoreMetadata.SplitId]);
        Assert.Equal("2026-11-04T15:00:00.0000000Z", metadata[DocStoreMetadata.ConfirmedAt]);
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

    [Fact]
    public async Task Disabled_UploadsAndDownloadsAre503sThatSayDocStoreIsntSetUp()
    {
        var off = new DisabledDocStoreClient();
        var ex = await Assert.ThrowsAsync<InfrastructureException>(() => off.UploadAsync(new DocStoreUpload("a.pdf", "application/pdf", Pdf, new Dictionary<string, string>()), default));
        Assert.Equal(503, ex.HttpStatusCode);
        await Assert.ThrowsAsync<InfrastructureException>(() => off.DownloadAsync(Guid.NewGuid().ToString(), default));
    }
}
