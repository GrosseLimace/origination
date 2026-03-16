using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Interfaces;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;

namespace GrainOriginatorPortal.Api.Tests;

public class PlantingIntentionsControllerTests
{
    private readonly Mock<IDataService> _mockDataService;
    private readonly Mock<ILogger<PlantingIntentionsController>> _mockLogger;
    private readonly Mock<IUserEntitlementService> _mockEntitlementService;
    private readonly PlantingIntentionsController _controller;

    public PlantingIntentionsControllerTests()
    {
        _mockDataService = new Mock<IDataService>();
        _mockLogger = new Mock<ILogger<PlantingIntentionsController>>();
        _mockEntitlementService = new Mock<IUserEntitlementService>();
        _controller = new PlantingIntentionsController(_mockDataService.Object, _mockLogger.Object, _mockEntitlementService.Object);
    }

    [Fact]
    public async Task GetAll_ReturnsOkWithIntentions()
    {
        var intentions = new List<PlantingIntention>
        {
            new PlantingIntention { Id = 1, Crop = "Corn", Acres = 500 }
        };
        _mockDataService
            .Setup(s => s.GetPlantingIntentionsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(intentions);

        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<PlantingIntention>>(ok.Value);
        Assert.Single(returned);
    }

    [Fact]
    public async Task GetByCustomer_ReturnsOkWithIntentions()
    {
        var intentions = new List<PlantingIntention> { new PlantingIntention { CustomerId = 42 } };
        _mockDataService
            .Setup(s => s.GetPlantingIntentionsByCustomerAsync(42, It.IsAny<CancellationToken>()))
            .ReturnsAsync(intentions);

        var result = await _controller.GetByCustomer(42);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.IsType<List<PlantingIntention>>(ok.Value);
    }

    [Fact]
    public async Task Update_ThrowsNotFoundException_WhenIntentionDoesNotExist()
    {
        _mockDataService
            .Setup(s => s.UpdatePlantingIntentionAsync(
                It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlantingIntention?)null);

        var request = new UpdatePlantingIntentionRequest
        {
            Crop = "Soybeans", Acres = 100, PlantingYear = 2026
        };

        await Assert.ThrowsAsync<NotFoundException>(() => _controller.Update(999, request));
    }

    [Fact]
    public async Task Update_ReturnsOk_WhenIntentionExists()
    {
        var updated = new PlantingIntention { Id = 1, Crop = "Soybeans", Acres = 100, PlantingYear = 2026 };
        _mockDataService
            .Setup(s => s.UpdatePlantingIntentionAsync(
                1, "Soybeans", null, null, 100, 2026,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(updated);

        var request = new UpdatePlantingIntentionRequest
        {
            Crop = "Soybeans", Acres = 100, PlantingYear = 2026
        };

        var result = await _controller.Update(1, request);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(updated, ok.Value);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccessful()
    {
        _mockDataService
            .Setup(s => s.DeletePlantingIntentionAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task Delete_ThrowsException_WhenServiceFails()
    {
        _mockDataService
            .Setup(s => s.DeletePlantingIntentionAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Exception("DB connection failed"));

        await Assert.ThrowsAsync<Exception>(() => _controller.Delete(1));
    }

}
