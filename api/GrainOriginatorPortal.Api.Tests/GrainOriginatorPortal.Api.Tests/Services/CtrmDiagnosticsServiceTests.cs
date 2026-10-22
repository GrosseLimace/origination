// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Pins the three CTRM probes that need no database: the connectivity probe's parsing of
/// totalCount/sample id and its Healthy verdict, the alias-batch verdict, and the per-producer
/// contract summary. The producer-timing probe reads Customer through the DbContext and is not
/// unit-tested here (no in-memory provider; see the csproj §8 deviation).
/// </summary>
public class CtrmDiagnosticsServiceTests
{
    private readonly Mock<ICtrmGraphQlClient> _ctrm = new();
    private readonly Mock<IContractRepository> _contracts = new();
    private readonly Mock<ITicketRepository> _tickets = new();
    private readonly CtrmDiagnosticsService _sut;

    public CtrmDiagnosticsServiceTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = "ctrm",
            ["Ctrm:GraphQlUri"] = "https://ctrm.example/graphql"
        }).Build();

        _sut = new CtrmDiagnosticsService(
            _ctrm.Object,
            config,
            _contracts.Object,
            _tickets.Object,
            new CtrmProvenance(),
            new CtrmContractReader(_ctrm.Object, config, new Mock<ILogger<CtrmContractReader>>().Object),
            new CtrmTicketReader(_ctrm.Object, config, new Mock<ILogger<CtrmTicketReader>>().Object),
            // Provider-less: the three probes under test never touch it.
            new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().Options));
    }

    private void GraphQlAnswers(CtrmReadStatus status, string? dataJson, int? httpStatus = null, string? errorCode = null, string? detail = null)
    {
        _ctrm.Setup(c => c.QueryAsync<JsonElement>(It.IsAny<string>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CtrmReadResult<JsonElement>
            {
                Status = status,
                Value = dataJson is null ? default : JsonDocument.Parse(dataJson).RootElement,
                HttpStatus = httpStatus,
                ErrorCode = errorCode,
                Detail = detail
            });
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Connectivity_Healthy_WhenOkWithAtLeastOneContract()
    {
        _ctrm.SetupGet(c => c.IsConfigured).Returns(true);
        GraphQlAnswers(CtrmReadStatus.Ok, """{"contracts":{"totalCount":417,"items":[{"contractId":"P12345"}]}}""", httpStatus: 200);

        var result = await _sut.GetConnectivityAsync(CancellationToken.None);

        Assert.True(result.Configured);
        Assert.Equal("ctrm", result.Source);
        Assert.Equal("https://ctrm.example/graphql", result.Endpoint);
        Assert.Equal("Ok", result.Status);
        Assert.Equal(200, result.HttpStatus);
        Assert.Equal(417, result.TotalCountInWindow);
        Assert.Equal("P12345", result.SampleContractId);
        Assert.True(result.Healthy);
        // Fixed 30-day window ending today.
        Assert.Equal(DateTime.Today.ToString("yyyy-MM-dd"), result.Window.To);
        Assert.Equal(DateTime.Today.AddDays(-30).ToString("yyyy-MM-dd"), result.Window.From);
    }

    [Fact]
    public async Task Connectivity_NotHealthy_WhenOkButNoRowsInWindow()
    {
        _ctrm.SetupGet(c => c.IsConfigured).Returns(true);
        GraphQlAnswers(CtrmReadStatus.Ok, """{"contracts":{"totalCount":0,"items":[]}}""");

        var result = await _sut.GetConnectivityAsync(CancellationToken.None);

        Assert.Equal(0, result.TotalCountInWindow);
        Assert.Null(result.SampleContractId);
        Assert.False(result.Healthy);
    }

    [Fact]
    public async Task Connectivity_SurfacesTheCategorizedFailure_WithoutParsingData()
    {
        _ctrm.SetupGet(c => c.IsConfigured).Returns(false);
        GraphQlAnswers(CtrmReadStatus.NotConfigured, null, detail: "Ctrm:GraphQlUri is not set");

        var result = await _sut.GetConnectivityAsync(CancellationToken.None);

        Assert.False(result.Configured);
        Assert.Equal("NotConfigured", result.Status);
        Assert.Equal("Ctrm:GraphQlUri is not set", result.Detail);
        Assert.Null(result.TotalCountInWindow);
        Assert.Null(result.SampleContractId);
        Assert.False(result.Healthy);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AliasBatch_Supported_WhenBothAliasesComeBack()
    {
        GraphQlAnswers(CtrmReadStatus.Ok, """{"t1":{"ticketNumber":"408279"},"t2":{"ticketNumber":"408279"}}""", httpStatus: 200);

        var result = await _sut.GetAliasBatchSupportAsync(CancellationToken.None);

        Assert.Equal(["t1", "t2"], result.AliasesReturned);
        Assert.True(result.Supported);
        Assert.StartsWith("Aliased batching works", result.Meaning);
    }

    [Fact]
    public async Task AliasBatch_NotSupported_WhenTheServerRejectsTheDocument()
    {
        GraphQlAnswers(CtrmReadStatus.Error, null, httpStatus: 400, errorCode: "HC0012", detail: "masked");

        var result = await _sut.GetAliasBatchSupportAsync(CancellationToken.None);

        Assert.Empty(result.AliasesReturned);
        Assert.False(result.Supported);
        Assert.StartsWith("Aliased batching did NOT work", result.Meaning);
        Assert.Equal("Error", result.Status);
        Assert.Equal(400, result.HttpStatus);
        Assert.Equal("HC0012", result.ErrorCode);
    }

    [Fact]
    public async Task AliasBatch_AsksForTheSameKnownGoodTicketTwice()
    {
        GraphQlAnswers(CtrmReadStatus.Ok, "{}");

        await _sut.GetAliasBatchSupportAsync(CancellationToken.None);

        _ctrm.Verify(c => c.QueryAsync<JsonElement>(
            It.Is<string>(d => d.Contains("t1: ticket(") && d.Contains("t2: ticket(")),
            It.IsAny<object?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ContractsForProducer_SummarisesEachContract_AndCountsItsPricingLines()
    {
        var syntheticId = CtrmSyntheticId.From("P", "123", "TATOBIN");
        _contracts.Setup(r => r.GetByCustomerAsync(0, "TATOBIN", It.IsAny<CancellationToken>())).ReturnsAsync(
        [
            new Contract { Id = 1, SourceContractId = "C-1", CtrmCustomerId = "TATOBIN", CommodityCode = "YC", Quantity = 5000, Status = ContractStatus.Active, CropYear = 2026 },
            new Contract { Id = syntheticId, SourceContractId = "C-2", CtrmCustomerId = "TATOBIN", CommodityCode = "YSB" }
        ]);
        _contracts.Setup(r => r.GetPricingLinesByCustomerAsync("TATOBIN", It.IsAny<CancellationToken>())).ReturnsAsync(
        [
            new ContractPricingLine { ContractId = "C-1" },
            new ContractPricingLine { ContractId = "C-1" },
            new ContractPricingLine { ContractId = "C-9" }
        ]);

        var result = await _sut.GetContractsForProducerAsync("TATOBIN", CancellationToken.None);

        Assert.Equal("TATOBIN", result.ScoularId);
        Assert.Equal("ods", result.ServedBy); // only a ContractRepositorySwitch can report "ctrm"
        Assert.Equal(2, result.ContractCount);
        Assert.Equal(3, result.PricingLineCount);

        var rows = result.Contracts.ToList();
        Assert.Equal(1, rows[0].Id);
        Assert.False(rows[0].Synthetic);
        Assert.Equal("Active", rows[0].Status);
        Assert.Equal(5000, rows[0].Quantity);
        Assert.Equal(2026, rows[0].CropYear);
        Assert.Equal(2, rows[0].PricingLines);
        Assert.True(rows[1].Synthetic);
        Assert.Equal(0, rows[1].PricingLines);
    }
}
