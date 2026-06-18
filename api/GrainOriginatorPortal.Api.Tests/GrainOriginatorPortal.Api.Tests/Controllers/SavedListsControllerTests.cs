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

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class SavedListsControllerTests
{
    private readonly Mock<ISavedListService> _serviceMock;
    private readonly SavedListsController _sut;

    public SavedListsControllerTests()
    {
        _serviceMock = new Mock<ISavedListService>();
        _sut = new SavedListsController(_serviceMock.Object, new Mock<ILogger<SavedListsController>>().Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ReturnsOkWithLists()
    {
        // Arrange
        var lists = new List<SavedListResponse> { new() { Id = 1, Name = "My List", Query = "corn" } };
        _serviceMock.Setup(s => s.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(lists);

        // Act
        var result = await _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<SavedListResponse>>(ok.Value);
        Assert.Single(returned);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetTeam_ReturnsOkWithTeamLists()
    {
        // Arrange
        var lists = new List<SavedListResponse>
        {
            new() { Id = 7, Name = "Joe's List", Query = "wheat", CreatedBy = "Joe Originator" }
        };
        _serviceMock
            .Setup(s => s.GetTeamListsAsync("TU1,TU2", It.IsAny<CancellationToken>()))
            .ReturnsAsync(lists);

        // Act
        var result = await _sut.GetTeam("TU1,TU2");

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<SavedListResponse>>(ok.Value);
        Assert.Equal("Joe Originator", Assert.Single(returned).CreatedBy);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Create_ReturnsCreated_WithNewList()
    {
        // Arrange
        var savedList = new SavedListResponse { Id = 5, Name = "Corn Growers", Query = "corn farmers" };
        _serviceMock
            .Setup(s => s.CreateAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(savedList);
        var request = new CreateSavedListRequest { Name = "Corn Growers", Query = "corn farmers" };

        // Act
        var result = await _sut.Create(request);

        // Assert
        var created = Assert.IsType<CreatedResult>(result.Result);
        Assert.Equal(savedList, created.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_ReturnsOk_WhenListExists()
    {
        // Arrange
        var updated = new SavedListResponse { Id = 1, Name = "Updated", Query = "new query" };
        _serviceMock
            .Setup(s => s.UpdateAsync(
                1, "Updated", "new query", It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(updated);
        var request = new CreateSavedListRequest { Name = "Updated", Query = "new query" };

        // Act
        var result = await _sut.Update(1, request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(updated, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_ThrowsNotFoundException_WhenListDoesNotExist()
    {
        // Arrange — service returns null, so the controller throws.
        _serviceMock
            .Setup(s => s.UpdateAsync(
                It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((SavedListResponse?)null);
        var request = new CreateSavedListRequest { Name = "x", Query = "y" };

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.Update(999, request));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccessful()
    {
        // Arrange
        _serviceMock.Setup(s => s.DeleteAsync(It.IsAny<int>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        // Act
        var result = await _sut.Delete(1);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _serviceMock.Verify(s => s.DeleteAsync(1, It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_ThrowsException_WhenServiceFails()
    {
        // Arrange
        _serviceMock
            .Setup(s => s.DeleteAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Exception("DB connection failed"));

        // Act & Assert
        await Assert.ThrowsAsync<Exception>(() => _sut.Delete(1));
    }
}
