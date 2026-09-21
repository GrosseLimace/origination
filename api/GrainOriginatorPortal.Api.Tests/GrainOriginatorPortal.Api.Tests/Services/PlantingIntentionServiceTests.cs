// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Trade-unit attribution rules for planting intentions. A producer on several trade units plants
/// different acres for each, so the row keeps the originator's choice — as long as it is one of the
/// producer's active trade units. See PlantingIntentionService.ResolveTradeUnitAsync.
/// </summary>
public class PlantingIntentionServiceTests
{
    private const long CustomerId = 4821;

    private readonly Mock<IPlantingIntentionRepository> _repositoryMock = new();
    private readonly Mock<ICustomerRepository> _customerRepositoryMock = new();
    private readonly Mock<IUserEntitlementService> _entitlementMock = new();
    private readonly Mock<IDisplayNameLookupRepository> _displayNameMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly PlantingIntentionService _sut;

    public PlantingIntentionServiceTests()
    {
        _displayNameMock
            .Setup(d => d.ResolveAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _requestContextMock.Setup(r => r.GetCurrentUser()).Returns("tester@scoular.com");
        _customerRepositoryMock
            .Setup(c => c.GetByIdAsync(CustomerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Customer { Id = CustomerId, Name = "Sample Farms", ScoularId = "SAMPFRM" });

        // AddAsync / UpdateAsync echo the trade unit they were given so assertions can read it back.
        _repositoryMock
            .Setup(r => r.AddAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(),
                It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(),
                It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((long customerId, string name, string code, string tradeUnit, string crop, string? category,
                string? type, string? description, int acres, int year, string user, CancellationToken _) =>
                new PlantingIntention
                {
                    Id = 1, CustomerId = customerId, CustomerName = name, CustomerCode = code, TradeUnit = tradeUnit,
                    Crop = crop, Category = category, Type = type, Description = description, Acres = acres,
                    PlantingYear = year, CreatedBy = user
                });
        _repositoryMock
            .Setup(r => r.UpdateAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((int id, string crop, string? category, string? type, string? description, int acres,
                int year, string? tradeUnit, string user, CancellationToken _) =>
                new PlantingIntention
                {
                    Id = id, CustomerId = CustomerId, TradeUnit = tradeUnit ?? "UNCHANGED", Crop = crop,
                    Category = category, Type = type, Description = description, Acres = acres, PlantingYear = year,
                    CreatedBy = "creator", ModifiedBy = user
                });

        _sut = new PlantingIntentionService(
            _repositoryMock.Object,
            _customerRepositoryMock.Object,
            _entitlementMock.Object,
            _displayNameMock.Object,
            _requestContextMock.Object,
            new Mock<ILogger<PlantingIntentionService>>().Object);
    }

    private void ProducerHasTradeUnits(params string[] codes) =>
        _customerRepositoryMock
            .Setup(c => c.GetActiveTradeUnitCodesAsync(CustomerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(codes.ToList());

    private Task<PlantingIntentionResponse> CreateAsync(string? tradeUnit) =>
        _sut.CreateAsync(CustomerId, null, null, tradeUnit, "Soybeans", "Soybeans", null, null, 390, 2026, CancellationToken.None);

    // -------------------------------------------------------------------------
    // Create — the originator's pick wins when it is one of the producer's trade units.
    [Fact]
    public async Task CreateAsync_KeepsChosenTradeUnit_WhenProducerBelongsToIt()
    {
        // Arrange — Craig is on Pratt (2190) and Tribune (2210); the originator picks Tribune.
        ProducerHasTradeUnits("2190", "2210");

        // Act
        var result = await CreateAsync("2210");

        // Assert
        Assert.Equal("2210", result.TradeUnit);
        _repositoryMock.Verify(r => r.AddAsync(CustomerId, "Sample Farms", "SAMPFRM", "2210",
            "Soybeans", "Soybeans", null, null, 390, 2026, "tester@scoular.com", It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_MatchesChosenTradeUnitCaseInsensitively_AndStoresCanonicalCode()
    {
        // Arrange
        ProducerHasTradeUnits("OMAHA", "PRATT");

        // Act
        var result = await CreateAsync(" pratt ");

        // Assert — stored value is the membership's spelling, not the client's.
        Assert.Equal("PRATT", result.TradeUnit);
    }

    // -------------------------------------------------------------------------
    // A trade unit the producer does not belong to is a validation error (400), never silently
    // replaced — otherwise the row would land on a dashboard nobody chose.
    [Fact]
    public async Task CreateAsync_Throws_WhenChosenTradeUnitIsNotOneOfTheProducers()
    {
        // Arrange
        ProducerHasTradeUnits("2190", "2210");

        // Act
        var ex = await Assert.ThrowsAsync<ValidationException>(() => CreateAsync("9999"));

        // Assert
        Assert.Contains("9999", ex.Message);
        _repositoryMock.Verify(r => r.AddAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(),
            It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    // No choice from the client → the producer's first trade unit by code. The repository returns
    // them ordered, so "first" is deterministic rather than storage order.
    [Fact]
    public async Task CreateAsync_DefaultsToFirstProducerTradeUnit_WhenClientSendsNone()
    {
        // Arrange
        ProducerHasTradeUnits("2190", "2210");

        // Act
        var result = await CreateAsync(null);

        // Assert
        Assert.Equal("2190", result.TradeUnit);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_TreatsBlankAsNoChoice()
    {
        // Arrange
        ProducerHasTradeUnits("2190");

        // Act
        var result = await CreateAsync("   ");

        // Assert
        Assert.Equal("2190", result.TradeUnit);
    }

    // -------------------------------------------------------------------------
    // Contracts-only producers have no dbo.CustomerTradeUnit rows yet; accept what the originator chose.
    [Fact]
    public async Task CreateAsync_AcceptsChosenTradeUnit_WhenProducerHasNoMembershipRows()
    {
        // Arrange
        ProducerHasTradeUnits();

        // Act
        var result = await CreateAsync("2190");

        // Assert
        Assert.Equal("2190", result.TradeUnit);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_Throws_WhenNothingChosenAndProducerHasNoMembershipRows()
    {
        // Arrange
        ProducerHasTradeUnits();

        // Act & Assert
        var ex = await Assert.ThrowsAsync<ValidationException>(() => CreateAsync(null));
        Assert.Contains("could not be determined", ex.Message);
    }

    // -------------------------------------------------------------------------
    // Update — same rule, applied against the row's own customer.
    [Fact]
    public async Task UpdateAsync_MovesRowToChosenTradeUnit_WhenProducerBelongsToIt()
    {
        // Arrange — the row exists for Craig, currently tagged Pratt; the originator re-tags it Tribune.
        ProducerHasTradeUnits("2190", "2210");
        _repositoryMock
            .Setup(r => r.GetByIdAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlantingIntention { Id = 7, CustomerId = CustomerId, TradeUnit = "2190", Crop = "Soybeans" });

        // Act
        var result = await _sut.UpdateAsync(7, "Soybeans", "Soybeans", null, null, 390, 2026, "2210", CancellationToken.None);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("2210", result!.TradeUnit);
        _repositoryMock.Verify(r => r.UpdateAsync(7, "Soybeans", "Soybeans", null, null, 390, 2026, "2210",
            "tester@scoular.com", It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateAsync_Throws_WhenChosenTradeUnitIsNotOneOfTheProducers()
    {
        // Arrange
        ProducerHasTradeUnits("2190", "2210");
        _repositoryMock
            .Setup(r => r.GetByIdAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlantingIntention { Id = 7, CustomerId = CustomerId, TradeUnit = "2190" });

        // Act & Assert
        await Assert.ThrowsAsync<ValidationException>(() =>
            _sut.UpdateAsync(7, "Soybeans", null, null, null, 390, 2026, "9999", CancellationToken.None));
        _repositoryMock.Verify(r => r.UpdateAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
            It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    // An edit that does not mention the trade unit (acres-only, older clients) leaves it alone and
    // does not even look the producer up.
    [Fact]
    public async Task UpdateAsync_LeavesTradeUnitUnchanged_WhenNoneSupplied()
    {
        // Act
        var result = await _sut.UpdateAsync(7, "Soybeans", null, null, null, 400, 2026, null, CancellationToken.None);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("UNCHANGED", result!.TradeUnit);
        _repositoryMock.Verify(r => r.UpdateAsync(7, "Soybeans", null, null, null, 400, 2026, null,
            "tester@scoular.com", It.IsAny<CancellationToken>()), Times.Once);
        _customerRepositoryMock.Verify(c => c.GetActiveTradeUnitCodesAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateAsync_ReturnsNull_WhenRowMissingAndTradeUnitSupplied()
    {
        // Arrange
        _repositoryMock
            .Setup(r => r.GetByIdAsync(99, It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlantingIntention?)null);

        // Act
        var result = await _sut.UpdateAsync(99, "Corn", null, null, null, 10, 2026, "2190", CancellationToken.None);

        // Assert
        Assert.Null(result);
    }
}
