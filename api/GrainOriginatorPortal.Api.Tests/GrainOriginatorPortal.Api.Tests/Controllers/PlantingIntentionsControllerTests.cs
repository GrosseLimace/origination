// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Interfaces;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class PlantingIntentionsControllerTests
{
    private readonly Mock<IDataService> _dataServiceMock;
    private readonly Mock<IUserEntitlementService> _entitlementServiceMock;
    private readonly PlantingIntentionsController _sut;

    public PlantingIntentionsControllerTests()
    {
        _dataServiceMock = new Mock<IDataService>();
        _entitlementServiceMock = new Mock<IUserEntitlementService>();
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(databaseName: $"PlantingIntentionsTest_{Guid.NewGuid()}")
            .Options;
        var appContext = new ApplicationDbContext(options);
        _sut = new PlantingIntentionsController(_dataServiceMock.Object, new Mock<ILogger<PlantingIntentionsController>>().Object, _entitlementServiceMock.Object, appContext);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ReturnsOkWithIntentions()
    {
        // Arrange
        var intentions = new List<PlantingIntention>
        {
            new PlantingIntention { Id = 1, CustomerId = 10, Crop = "Corn", Acres = 200, PlantingYear = 2026 }
        };
        _dataServiceMock.Setup(s => s.GetPlantingIntentionsAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<int?>(), It.IsAny<CancellationToken>())).ReturnsAsync(intentions);

        // Act
        var result = await _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<PlantingIntention>>(ok.Value);
        Assert.Single(returned);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomer_ReturnsOkWithCustomerIntentions()
    {
        // Arrange
        var intentions = new List<PlantingIntention>
        {
            new PlantingIntention { Id = 2, CustomerId = 5, Crop = "Soybeans", Acres = 150, PlantingYear = 2026 }
        };
        _dataServiceMock.Setup(s => s.GetPlantingIntentionsByCustomerAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(intentions);

        // Act
        var result = await _sut.GetByCustomer(5);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(Assert.IsAssignableFrom<List<PlantingIntention>>(ok.Value));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_WhenFound_ReturnsOk()
    {
        // Arrange
        var updated = new PlantingIntention { Id = 3, Crop = "Wheat", Acres = 100, PlantingYear = 2026 };
        _dataServiceMock
            .Setup(s => s.UpdatePlantingIntentionAsync(3, "Wheat", null, null, 100, 2026, It.IsAny<CancellationToken>()))
            .ReturnsAsync(updated);

        var request = new UpdatePlantingIntentionRequest
        {
            Crop = "Wheat", Acres = 100, PlantingYear = 2026
        };

        // Act
        var result = await _sut.Update(3, request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(updated, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_WhenNotFound_ThrowsNotFoundException()
    {
        // Arrange
        _dataServiceMock
            .Setup(s => s.UpdatePlantingIntentionAsync(99, It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlantingIntention?)null);

        var request = new UpdatePlantingIntentionRequest { Crop = "Corn", Acres = 100, PlantingYear = 2026 };

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.Update(99, request));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_CallsDeleteAndReturnsNoContent()
    {
        // Arrange
        _dataServiceMock.Setup(s => s.DeletePlantingIntentionAsync(4, It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        // Act
        var result = await _sut.Delete(4);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _dataServiceMock.Verify(s => s.DeletePlantingIntentionAsync(4, It.IsAny<CancellationToken>()), Times.Once);
    }
}
