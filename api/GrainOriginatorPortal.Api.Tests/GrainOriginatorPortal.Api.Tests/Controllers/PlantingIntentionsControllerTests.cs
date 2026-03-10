// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Interfaces;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class PlantingIntentionsControllerTests
{
    private readonly Mock<IDataService> _dataServiceMock;
    private readonly PlantingIntentionsController _sut;

    public PlantingIntentionsControllerTests()
    {
        _dataServiceMock = new Mock<IDataService>();
        _sut = new PlantingIntentionsController(_dataServiceMock.Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetAll_ReturnsOkWithIntentions()
    {
        // Arrange
        var intentions = new List<PlantingIntention>
        {
            new PlantingIntention { Id = 1, CustomerId = 10, Crop = "Corn", Acres = 200, PlantingYear = 2026 }
        };
        _dataServiceMock.Setup(s => s.GetPlantingIntentions()).Returns(intentions);

        // Act
        var result = _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<PlantingIntention>>(ok.Value);
        Assert.Single(returned);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetByCustomer_ReturnsOkWithCustomerIntentions()
    {
        // Arrange
        var intentions = new List<PlantingIntention>
        {
            new PlantingIntention { Id = 2, CustomerId = 5, Crop = "Soybeans", Acres = 150, PlantingYear = 2026 }
        };
        _dataServiceMock.Setup(s => s.GetPlantingIntentionsByCustomer(5)).Returns(intentions);

        // Act
        var result = _sut.GetByCustomer(5);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(Assert.IsAssignableFrom<List<PlantingIntention>>(ok.Value));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Update_WhenFound_ReturnsOk()
    {
        // Arrange
        var updated = new PlantingIntention { Id = 3, Crop = "Wheat", Acres = 100, PlantingYear = 2026 };
        _dataServiceMock
            .Setup(s => s.UpdatePlantingIntention(3, "Wheat", null, null, 100, 2026))
            .Returns(updated);

        var request = new UpdatePlantingIntentionRequest
        {
            Crop = "Wheat", Acres = 100, PlantingYear = 2026
        };

        // Act
        var result = _sut.Update(3, request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(updated, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Update_WhenNotFound_ReturnsNotFound()
    {
        // Arrange
        _dataServiceMock
            .Setup(s => s.UpdatePlantingIntention(99, It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>()))
            .Returns((PlantingIntention?)null);

        var request = new UpdatePlantingIntentionRequest { Crop = "Corn", Acres = 100, PlantingYear = 2026 };

        // Act
        var result = _sut.Update(99, request);

        // Assert
        Assert.IsType<NotFoundResult>(result.Result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Delete_CallsDeleteAndReturnsNoContent()
    {
        // Arrange
        _dataServiceMock.Setup(s => s.DeletePlantingIntention(4));

        // Act
        var result = _sut.Delete(4);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _dataServiceMock.Verify(s => s.DeletePlantingIntention(4), Times.Once);
    }
}
