// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// FarmService is a thin mapping layer over IFarmRepository. These pin the entity-to-response
/// mapping (including the nullable bin capacity), the null path for a missing farm, and argument
/// forwarding.
/// </summary>
public class FarmServiceTests
{
    private readonly Mock<IFarmRepository> _repositoryMock = new();
    private readonly FarmService _sut;

    public FarmServiceTests()
    {
        _sut = new FarmService(_repositoryMock.Object);
    }

    [Fact]
    public async Task GetAllAsync_ForwardsTradeUnitsAndMapsEveryField()
    {
        var tradeUnits = new List<string> { "2090" };
        _repositoryMock
            .Setup(r => r.GetAsync(tradeUnits, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new Farm { Id = "F-1", Name = "North 80", Location = "Omaha, NE", Acres = 80, BinStorageCapacity = 50_000 },
                new Farm { Id = "F-2", Name = "South 40", Location = "Lincoln, NE", Acres = 40, BinStorageCapacity = null },
            ]);

        var result = await _sut.GetAllAsync(tradeUnits, CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Equal(("F-1", "North 80", "Omaha, NE", 80, (int?)50_000), (result[0].Id, result[0].Name, result[0].Location, result[0].Acres, result[0].BinStorageCapacity));
        Assert.Null(result[1].BinStorageCapacity); // unknown capacity stays null, not 0
    }

    [Fact]
    public async Task GetAllAsync_WhenTheRepositoryReturnsNothing_ReturnsEmpty()
    {
        _repositoryMock.Setup(r => r.GetAsync(null, It.IsAny<CancellationToken>())).ReturnsAsync([]);

        var result = await _sut.GetAllAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetByIdAsync_WhenTheFarmIsMissing_ReturnsNull()
    {
        _repositoryMock.Setup(r => r.GetByIdAsync("missing", It.IsAny<CancellationToken>())).ReturnsAsync((Farm?)null);

        var result = await _sut.GetByIdAsync("missing", CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetByIdAsync_WhenTheFarmExists_MapsIt()
    {
        _repositoryMock
            .Setup(r => r.GetByIdAsync("F-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Farm { Id = "F-1", Name = "North 80", Location = "Omaha, NE", Acres = 80 });

        var result = await _sut.GetByIdAsync("F-1", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("F-1", result.Id);
        Assert.Equal("North 80", result.Name);
        Assert.Equal(80, result.Acres);
    }

    [Fact]
    public async Task GetByCustomerAsync_ForwardsTheCustomerIdAndMapsFarms()
    {
        _repositoryMock
            .Setup(r => r.GetByCustomerAsync(42L, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new Farm { Id = "F-9", Name = "Home Place", Acres = 160 }]);

        var result = await _sut.GetByCustomerAsync(42L, CancellationToken.None);

        var farm = Assert.Single(result);
        Assert.Equal("F-9", farm.Id);
        Assert.Equal(160, farm.Acres);
    }

    [Fact]
    public async Task CreateAsync_ForwardsTheArgumentsAndReturnsTheNewId()
    {
        _repositoryMock
            .Setup(r => r.CreateAsync("New Ground", "Kearney, NE", 320, It.IsAny<CancellationToken>()))
            .ReturnsAsync("F-new");

        var id = await _sut.CreateAsync("New Ground", "Kearney, NE", 320, CancellationToken.None);

        Assert.Equal("F-new", id);
    }
}
