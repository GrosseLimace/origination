// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Read/upsert paths of DashboardService. The delete guard (H-061) is pinned separately in
/// DashboardActualHarvestDeleteTests; these cover the year offset in the summary, the DTO-to-entity
/// mapping on every upsert, and the audit stamp. The upserts are the only place the acting user
/// is attached, and a dropped stamp would silently write "" as CreatedBy.
/// </summary>
public class DashboardServiceTests
{
    private const string CurrentUser = "cegr@scoular.com";

    private readonly Mock<IDashboardRepository> _repositoryMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly Mock<IUserEntitlementService> _entitlementMock = new();
    private readonly DashboardService _sut;

    public DashboardServiceTests()
    {
        _requestContextMock.Setup(r => r.GetCurrentUser()).Returns(CurrentUser);
        _sut = new DashboardService(_repositoryMock.Object, _requestContextMock.Object, _entitlementMock.Object);
    }

    // The dashboard compares THIS year's estimates and market share against LAST year's actual
    // harvest. The -1 is the whole point of the summary endpoint.
    [Fact]
    public async Task GetSummaryAsync_ReadsActualHarvestForThePriorYearAndTheRestForTheRequestedYear()
    {
        SetupReads("2090", 2026);

        var result = await _sut.GetSummaryAsync("2090", 2026, CancellationToken.None);

        _repositoryMock.Verify(r => r.GetPlantingEstimatesAsync("2090", 2026, It.IsAny<CancellationToken>()), Times.Once);
        _repositoryMock.Verify(r => r.GetMarketSharesAsync("2090", 2026, It.IsAny<CancellationToken>()), Times.Once);
        _repositoryMock.Verify(r => r.GetActualHarvestAsync("2090", 2025, It.IsAny<CancellationToken>()), Times.Once);
        Assert.Equal(2025, Assert.Single(result.ActualHarvest).PlantingYear);
    }

    [Fact]
    public async Task GetSummaryAsync_MapsAllThreeCollections()
    {
        SetupReads("2090", 2026);

        var result = await _sut.GetSummaryAsync("2090", 2026, CancellationToken.None);

        var estimate = Assert.Single(result.Estimates);
        Assert.Equal("Corn", estimate.Crop);
        Assert.Equal(185.5m, estimate.YieldEstimate);
        var share = Assert.Single(result.MarketShares);
        Assert.Equal("Oilseeds", share.CropCategory);
        Assert.Equal(12.5m, share.MarketSharePct);
        var harvest = Assert.Single(result.ActualHarvest);
        Assert.Equal(1_250_000, harvest.Bushels);
    }

    [Fact]
    public async Task GetSummaryAsync_WhenNothingIsStored_ReturnsEmptyListsNotNulls()
    {
        _repositoryMock.Setup(r => r.GetPlantingEstimatesAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>())).ReturnsAsync([]);
        _repositoryMock.Setup(r => r.GetMarketSharesAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>())).ReturnsAsync([]);
        _repositoryMock.Setup(r => r.GetActualHarvestAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>())).ReturnsAsync([]);

        var result = await _sut.GetSummaryAsync("2090", 2026, CancellationToken.None);

        Assert.NotNull(result.Estimates);
        Assert.NotNull(result.MarketShares);
        Assert.NotNull(result.ActualHarvest);
        Assert.Empty(result.Estimates);
        Assert.Empty(result.MarketShares);
        Assert.Empty(result.ActualHarvest);
    }

    [Fact]
    public async Task GetPlantingEstimatesAsync_MapsEveryFieldIncludingTheAuditColumns()
    {
        var created = new DateTime(2026, 3, 1, 12, 0, 0, DateTimeKind.Utc);
        var modified = created.AddDays(2);
        _repositoryMock
            .Setup(r => r.GetPlantingEstimatesAsync("2090", 2026, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DashboardPlantingEstimate
            {
                Id = 7, TradeUnitKey = "2090", Crop = "Soybeans", PlantingYear = 2026, YieldEstimate = null,
                CreatedAt = created, CreatedBy = "a@scoular.com", ModifiedAt = modified, ModifiedBy = "b@scoular.com",
            }]);

        var result = await _sut.GetPlantingEstimatesAsync("2090", 2026, CancellationToken.None);

        var row = Assert.Single(result);
        Assert.Equal(7, row.Id);
        Assert.Equal("2090", row.TradeUnitKey);
        Assert.Equal("Soybeans", row.Crop);
        Assert.Equal(2026, row.PlantingYear);
        Assert.Null(row.YieldEstimate); // a blank estimate stays blank, not 0
        Assert.Equal(created, row.CreatedAt);
        Assert.Equal("a@scoular.com", row.CreatedBy);
        Assert.Equal(modified, row.ModifiedAt);
        Assert.Equal("b@scoular.com", row.ModifiedBy);
    }

    [Fact]
    public async Task UpsertPlantingEstimatesAsync_MapsEachRequestAndStampsTheCurrentUser()
    {
        List<DashboardPlantingEstimate>? captured = null;
        string? stampedUser = null;
        _repositoryMock
            .Setup(r => r.UpsertPlantingEstimatesAsync(It.IsAny<List<DashboardPlantingEstimate>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<List<DashboardPlantingEstimate>, string, CancellationToken>((rows, user, _) => { captured = rows; stampedUser = user; })
            .Returns(Task.CompletedTask);

        await _sut.UpsertPlantingEstimatesAsync(
            [
                new UpsertDashboardEstimateRequest { TradeUnitKey = "2090", Crop = "Corn", PlantingYear = 2026, YieldEstimate = 190m },
                new UpsertDashboardEstimateRequest { TradeUnitKey = "2090", Crop = "Soybeans", PlantingYear = 2026, YieldEstimate = null },
            ],
            CancellationToken.None);

        Assert.Equal(CurrentUser, stampedUser);
        Assert.NotNull(captured);
        Assert.Equal(2, captured.Count);
        Assert.Equal(("2090", "Corn", 2026, (decimal?)190m), (captured[0].TradeUnitKey, captured[0].Crop, captured[0].PlantingYear, captured[0].YieldEstimate));
        Assert.Equal(("2090", "Soybeans", 2026, (decimal?)null), (captured[1].TradeUnitKey, captured[1].Crop, captured[1].PlantingYear, captured[1].YieldEstimate));
    }

    [Fact]
    public async Task UpsertMarketSharesAsync_MapsEachRequestAndStampsTheCurrentUser()
    {
        List<DashboardMarketShare>? captured = null;
        string? stampedUser = null;
        _repositoryMock
            .Setup(r => r.UpsertMarketSharesAsync(It.IsAny<List<DashboardMarketShare>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<List<DashboardMarketShare>, string, CancellationToken>((rows, user, _) => { captured = rows; stampedUser = user; })
            .Returns(Task.CompletedTask);

        await _sut.UpsertMarketSharesAsync(
            [new UpsertDashboardMarketShareRequest { TradeUnitKey = "2291", CropCategory = "Wheat", PlantingYear = 2026, MarketSharePct = 33.3m }],
            CancellationToken.None);

        Assert.Equal(CurrentUser, stampedUser);
        var row = Assert.Single(captured!);
        Assert.Equal("2291", row.TradeUnitKey);
        Assert.Equal("Wheat", row.CropCategory);
        Assert.Equal(2026, row.PlantingYear);
        Assert.Equal(33.3m, row.MarketSharePct);
    }

    [Fact]
    public async Task UpsertActualHarvestAsync_MapsEachRequestAndStampsTheCurrentUser()
    {
        List<DashboardActualHarvest>? captured = null;
        string? stampedUser = null;
        _repositoryMock
            .Setup(r => r.UpsertActualHarvestAsync(It.IsAny<List<DashboardActualHarvest>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<List<DashboardActualHarvest>, string, CancellationToken>((rows, user, _) => { captured = rows; stampedUser = user; })
            .Returns(Task.CompletedTask);

        await _sut.UpsertActualHarvestAsync(
            [new UpsertDashboardActualHarvestRequest { TradeUnitKey = "2090", CropCategory = "Corn", PlantingYear = 2025, Bushels = 2_400_000 }],
            CancellationToken.None);

        Assert.Equal(CurrentUser, stampedUser);
        var row = Assert.Single(captured!);
        Assert.Equal("2090", row.TradeUnitKey);
        Assert.Equal("Corn", row.CropCategory);
        Assert.Equal(2025, row.PlantingYear);
        Assert.Equal(2_400_000, row.Bushels);
    }

    // The service does not pre-filter: an empty payload still reaches the repository, which owns
    // the "nothing to do" decision. Pins that the service is a pure mapper here.
    [Fact]
    public async Task UpsertPlantingEstimatesAsync_WithNoRows_StillForwardsAnEmptyListToTheRepository()
    {
        await _sut.UpsertPlantingEstimatesAsync([], CancellationToken.None);

        _repositoryMock.Verify(r => r.UpsertPlantingEstimatesAsync(
            It.Is<List<DashboardPlantingEstimate>>(rows => rows.Count == 0), CurrentUser, It.IsAny<CancellationToken>()), Times.Once);
    }

    private void SetupReads(string tradeUnitKey, int plantingYear)
    {
        _repositoryMock
            .Setup(r => r.GetPlantingEstimatesAsync(tradeUnitKey, plantingYear, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DashboardPlantingEstimate { Id = 1, TradeUnitKey = tradeUnitKey, Crop = "Corn", PlantingYear = plantingYear, YieldEstimate = 185.5m }]);
        _repositoryMock
            .Setup(r => r.GetMarketSharesAsync(tradeUnitKey, plantingYear, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DashboardMarketShare { Id = 2, TradeUnitKey = tradeUnitKey, CropCategory = "Oilseeds", PlantingYear = plantingYear, MarketSharePct = 12.5m }]);
        _repositoryMock
            .Setup(r => r.GetActualHarvestAsync(tradeUnitKey, plantingYear - 1, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DashboardActualHarvest { Id = 3, TradeUnitKey = tradeUnitKey, CropCategory = "Corn", PlantingYear = plantingYear - 1, Bushels = 1_250_000 }]);
    }
}
