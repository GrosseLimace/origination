using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;

namespace GrainOriginatorPortal.Api.Tests;

public class SavedListsControllerTests
{
    private readonly Mock<IDataService> _mockDataService;
    private readonly Mock<ILogger<SavedListsController>> _mockLogger;
    private readonly SavedListsController _controller;

    public SavedListsControllerTests()
    {
        _mockDataService = new Mock<IDataService>();
        _mockLogger = new Mock<ILogger<SavedListsController>>();
        _controller = new SavedListsController(_mockDataService.Object, _mockLogger.Object);
    }

    [Fact]
    public void GetAll_ReturnsOkWithLists()
    {
        var lists = new List<SavedList> { new SavedList { Id = 1, Name = "My List" } };
        _mockDataService.Setup(s => s.GetSavedLists()).Returns(lists);

        var result = _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<SavedList>>(ok.Value);
        Assert.Single(returned);
    }

    [Fact]
    public void Create_ReturnsCreated_WithNewList()
    {
        var savedList = new SavedList { Id = 5, Name = "Corn Growers", Query = "corn farmers" };
        _mockDataService
            .Setup(s => s.SaveList(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .Returns(savedList);

        var request = new CreateSavedListRequest { Name = "Corn Growers", Query = "corn farmers" };
        var result = _controller.Create(request);

        var created = Assert.IsType<CreatedResult>(result.Result);
        Assert.Equal(savedList, created.Value);
    }

    [Fact]
    public void Update_ReturnsNotFound_WhenListDoesNotExist()
    {
        _mockDataService
            .Setup(s => s.UpdateList(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .Returns((SavedList?)null);

        var result = _controller.Update(999, new CreateSavedListRequest { Name = "x", Query = "y" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public void Delete_ReturnsNoContent_WhenSuccessful()
    {
        _mockDataService.Setup(s => s.DeleteList(It.IsAny<int>()));

        var result = _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public void Delete_Returns500_WhenExceptionThrown()
    {
        _mockDataService.Setup(s => s.DeleteList(It.IsAny<int>()))
            .Throws(new Exception("DB connection failed"));

        var result = _controller.Delete(1);

        var statusResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(500, statusResult.StatusCode);
    }

    [Fact]
    public void HasAuthorizeAttribute()
    {
        var attrs = typeof(SavedListsController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true);
        Assert.NotEmpty(attrs);
    }
}
