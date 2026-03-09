using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;

namespace GrainOriginatorPortal.Api.Tests;

public class PlantingIntentionsControllerTests
{
    private readonly Mock<IDataService> _mockDataService;
    private readonly Mock<ILogger<PlantingIntentionsController>> _mockLogger;
    private readonly PlantingIntentionsController _controller;

    public PlantingIntentionsControllerTests()
    {
        _mockDataService = new Mock<IDataService>();
        _mockLogger = new Mock<ILogger<PlantingIntentionsController>>();
        _controller = new PlantingIntentionsController(_mockDataService.Object, _mockLogger.Object);
    }

    [Fact]
    public void GetAll_ReturnsOkWithIntentions()
    {
        var intentions = new List<PlantingIntention>
        {
            new PlantingIntention { Id = 1, Crop = "Corn", Acres = 500 }
        };
        _mockDataService.Setup(s => s.GetPlantingIntentions()).Returns(intentions);

        var result = _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<PlantingIntention>>(ok.Value);
        Assert.Single(returned);
    }

    [Fact]
    public void GetByCustomer_ReturnsOkWithIntentions()
    {
        var intentions = new List<PlantingIntention> { new PlantingIntention { CustomerId = 42 } };
        _mockDataService.Setup(s => s.GetPlantingIntentionsByCustomer(42)).Returns(intentions);

        var result = _controller.GetByCustomer(42);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.IsType<List<PlantingIntention>>(ok.Value);
    }

    [Fact]
    public void Update_ReturnsNotFound_WhenIntentionDoesNotExist()
    {
        _mockDataService
            .Setup(s => s.UpdatePlantingIntention(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>()))
            .Returns((PlantingIntention?)null);

        var result = _controller.Update(999, new UpdatePlantingIntentionRequest
        {
            Crop = "Soybeans", Acres = 100, PlantingYear = 2026
        });

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public void Delete_ReturnsNoContent_WhenSuccessful()
    {
        _mockDataService.Setup(s => s.DeletePlantingIntention(It.IsAny<int>()));

        var result = _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public void Delete_Returns500_WhenExceptionThrown()
    {
        _mockDataService.Setup(s => s.DeletePlantingIntention(It.IsAny<int>()))
            .Throws(new Exception("DB connection failed"));

        var result = _controller.Delete(1);

        var statusResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(500, statusResult.StatusCode);
    }

    [Fact]
    public void HasAuthorizeAttribute()
    {
        var attrs = typeof(PlantingIntentionsController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true);
        Assert.NotEmpty(attrs);
    }
}
