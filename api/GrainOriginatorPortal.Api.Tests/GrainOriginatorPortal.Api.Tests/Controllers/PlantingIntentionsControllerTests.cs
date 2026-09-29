// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class PlantingIntentionsControllerTests
{
    private readonly Mock<IPlantingIntentionService> _serviceMock;
    private readonly CapturingLogger<PlantingIntentionsController> _logger = new();
    private readonly PlantingIntentionsController _sut;

    public PlantingIntentionsControllerTests()
    {
        _serviceMock = new Mock<IPlantingIntentionService>();
        // The request context names the actor in the AUDIT_ log lines (M-043); a stub suffices here.
        var requestContext = new Mock<IRequestContextService>();
        requestContext.Setup(r => r.GetCurrentUser()).Returns("tester");
        _sut = new PlantingIntentionsController(_serviceMock.Object, requestContext.Object, _logger);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ReturnsOkWithIntentions()
    {
        // Arrange
        var intentions = new List<PlantingIntentionResponse>
        {
            new() { Id = 1, CustomerId = 10, Crop = "Corn", Acres = 200, PlantingYear = 2026 }
        };
        _serviceMock.Setup(s => s.GetAllAsync(It.IsAny<string?>(), It.IsAny<int?>(), It.IsAny<CancellationToken>())).ReturnsAsync(intentions);

        // Act
        var result = await _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<PlantingIntentionResponse>>(ok.Value);
        Assert.Single(returned);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomer_ReturnsOkWithCustomerIntentions()
    {
        // Arrange
        var intentions = new List<PlantingIntentionResponse>
        {
            new() { Id = 2, CustomerId = 5, Crop = "Soybeans", Acres = 150, PlantingYear = 2026 }
        };
        _serviceMock.Setup(s => s.GetByCustomerAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(intentions);

        // Act
        var result = await _sut.GetByCustomer(5);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(Assert.IsAssignableFrom<List<PlantingIntentionResponse>>(ok.Value));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_WhenFound_ReturnsOk()
    {
        // Arrange
        var existing = new PlantingIntentionResponse { Id = 3, Crop = "Wheat", Acres = 100, PlantingYear = 2026 };
        var updated = new PlantingIntentionResponse { Id = 3, Crop = "Wheat", Acres = 100, PlantingYear = 2026 };
        _serviceMock.Setup(s => s.GetByIdAsync(3, It.IsAny<CancellationToken>())).ReturnsAsync(existing);
        _serviceMock
            .Setup(s => s.UpdateAsync(3, "Wheat", null, null, null, 100, 2026, "2190", It.IsAny<CancellationToken>()))
            .ReturnsAsync(updated);

        var request = new UpdatePlantingIntentionRequest
        {
            Crop = "Wheat", Acres = 100, PlantingYear = 2026, TradeUnit = "2190"
        };

        // Act
        var result = await _sut.Update(3, request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(updated, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_ThatMovesTheTradeUnit_AuditsWhereItCameFromAndWho()
    {
        // Moving a row changes which trade unit's acreage it counts toward. Without the previous trade
        // unit in the audit line, the move could not be traced or undone (AR-01 update 2026-09-28).
        _serviceMock.Setup(s => s.GetByIdAsync(3, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlantingIntentionResponse { Id = 3, Crop = "Wheat", TradeUnit = "2210" });
        _serviceMock
            .Setup(s => s.UpdateAsync(3, "Wheat", null, null, null, 100, 2026, "2190", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlantingIntentionResponse { Id = 3, Crop = "Wheat", TradeUnit = "2190" });

        await _sut.Update(3, new UpdatePlantingIntentionRequest { Crop = "Wheat", Acres = 100, PlantingYear = 2026, TradeUnit = "2190" });

        var audit = _logger.Audit("AUDIT_UPDATE").Fields;
        Assert.Equal(3, audit["IntentionId"]);
        Assert.Equal("2210", audit["FromTradeUnit"]);
        Assert.Equal("2190", audit["TradeUnit"]);
        Assert.Equal("tester", audit["User"]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_WhenNotFound_ThrowsNotFoundException()
    {
        // Arrange — existence check returns null, so the controller throws before calling UpdateAsync.
        _serviceMock.Setup(s => s.GetByIdAsync(99, It.IsAny<CancellationToken>())).ReturnsAsync((PlantingIntentionResponse?)null);

        var request = new UpdatePlantingIntentionRequest { Crop = "Corn", Acres = 100, PlantingYear = 2026 };

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.Update(99, request));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_CallsDeleteAndReturnsNoContent()
    {
        // Arrange
        _serviceMock.Setup(s => s.GetByIdAsync(4, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlantingIntentionResponse { Id = 4, Crop = "Corn", Acres = 50, PlantingYear = 2026 });
        _serviceMock.Setup(s => s.DeleteAsync(4, It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        // Act
        var result = await _sut.Delete(4);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _serviceMock.Verify(s => s.DeleteAsync(4, It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    // The controller forwards the originator's trade-unit choice untouched; the service decides
    // whether it is one of the producer's.
    [Fact]
    public async Task Create_ForwardsChosenTradeUnitToService()
    {
        // Arrange
        var created = new PlantingIntentionResponse { Id = 5, CustomerId = 10, Crop = "Soybeans", Acres = 390, PlantingYear = 2026, TradeUnit = "2210" };
        _serviceMock
            .Setup(s => s.CreateAsync(10, "Sample Farms", "SAMPFRM", "2210", "Soybeans", "Soybeans", null, null, 390, 2026, It.IsAny<CancellationToken>()))
            .ReturnsAsync(created);

        var request = new CreatePlantingIntentionRequest
        {
            CustomerId = 10, CustomerName = "Sample Farms", CustomerCode = "SAMPFRM", TradeUnit = "2210",
            Crop = "Soybeans", Category = "Soybeans", Acres = 390, PlantingYear = 2026
        };

        // Act
        var result = await _sut.Create(request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(created, ok.Value);
    }

    // -------------------------------------------------------------------------
    // Retag moves a producer's rows off a trade unit they've been removed from; the count comes
    // back so the caller can tell the user what happened.
    [Fact]
    public async Task Retag_ReturnsTheNumberOfRowsMoved()
    {
        // Arrange
        _serviceMock
            .Setup(s => s.RetagAsync(10, "2210", "2190", It.IsAny<CancellationToken>()))
            .ReturnsAsync(2);

        var request = new RetagPlantingIntentionsRequest
        {
            CustomerId = 10, FromTradeUnit = "2210", ToTradeUnit = "2190"
        };

        // Act
        var result = await _sut.Retag(request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(2, Assert.IsType<RetagPlantingIntentionsResponse>(ok.Value).Moved);
        _serviceMock.Verify(s => s.RetagAsync(10, "2210", "2190", It.IsAny<CancellationToken>()), Times.Once);

        // The audit line names the actor. It did not until 2026-09-28, the same gap M-043 closed on
        // create/update/delete: a bulk move of a producer's acres with no record of who made it.
        var audit = _logger.Audit("AUDIT_UPDATE").Fields;
        Assert.Equal(10L, audit["CustomerId"]);
        Assert.Equal("2210", audit["From"]);
        Assert.Equal("2190", audit["To"]);
        Assert.Equal(2, audit["Count"]);
        Assert.Equal("tester", audit["User"]);
    }
}
