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

public class SavedListsControllerTests
{
    private readonly Mock<IDataService> _mockDataService;
    private readonly Mock<IUserEntitlementService> _mockEntitlementService;
    private readonly Mock<ILogger<SavedListsController>> _mockLogger;
    private readonly SavedListsController _controller;

    public SavedListsControllerTests()
    {
        _mockDataService = new Mock<IDataService>();
        _mockEntitlementService = new Mock<IUserEntitlementService>();
        _mockLogger = new Mock<ILogger<SavedListsController>>();
        _controller = new SavedListsController(_mockDataService.Object, _mockEntitlementService.Object, _mockLogger.Object);
    }

    [Fact]
    public async Task GetAll_ReturnsOkWithLists()
    {
        var lists = new List<SavedList> { new SavedList { Id = 1, Name = "My List" } };
        _mockDataService
            .Setup(s => s.GetSavedListsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(lists);

        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<SavedList>>(ok.Value);
        Assert.Single(returned);
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithNewList()
    {
        var savedList = new SavedList { Id = 5, Name = "Corn Growers", Query = "corn farmers" };
        _mockDataService
            .Setup(s => s.SaveListAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(savedList);

        var request = new CreateSavedListRequest { Name = "Corn Growers", Query = "corn farmers" };
        var result = await _controller.Create(request);

        var created = Assert.IsType<CreatedResult>(result.Result);
        Assert.Equal(savedList, created.Value);
    }

    [Fact]
    public async Task Update_ThrowsNotFoundException_WhenListDoesNotExist()
    {
        _mockDataService
            .Setup(s => s.UpdateListAsync(
                It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((SavedList?)null);

        var request = new CreateSavedListRequest { Name = "x", Query = "y" };

        await Assert.ThrowsAsync<NotFoundException>(() => _controller.Update(999, request));
    }

    [Fact]
    public async Task Update_ReturnsOk_WhenListExists()
    {
        var updated = new SavedList { Id = 1, Name = "Updated", Query = "new query" };
        _mockDataService
            .Setup(s => s.UpdateListAsync(
                1, "Updated", "new query", null, null,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(updated);

        var request = new CreateSavedListRequest { Name = "Updated", Query = "new query" };
        var result = await _controller.Update(1, request);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(updated, ok.Value);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccessful()
    {
        _mockDataService
            .Setup(s => s.DeleteListAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task Delete_ThrowsException_WhenServiceFails()
    {
        _mockDataService
            .Setup(s => s.DeleteListAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Exception("DB connection failed"));

        await Assert.ThrowsAsync<Exception>(() => _controller.Delete(1));
    }

}
