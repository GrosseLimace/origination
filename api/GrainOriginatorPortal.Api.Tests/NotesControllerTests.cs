using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;

namespace GrainOriginatorPortal.Api.Tests;

public class NotesControllerTests
{
    private readonly Mock<IDataService> _mockDataService;
    private readonly Mock<ILogger<NotesController>> _mockLogger;
    private readonly NotesController _controller;

    public NotesControllerTests()
    {
        _mockDataService = new Mock<IDataService>();
        _mockLogger = new Mock<ILogger<NotesController>>();
        _controller = new NotesController(_mockDataService.Object, _mockLogger.Object);
    }

    [Fact]
    public void GetAll_ReturnsOkWithNotes()
    {
        var notes = new List<Note> { new Note { Id = 1, Description = "Test note" } };
        _mockDataService.Setup(s => s.GetNotes()).Returns(notes);

        var result = _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<Note>>(ok.Value);
        Assert.Single(returned);
    }

    [Fact]
    public void GetByCustomer_ReturnsOkWithNotes()
    {
        var notes = new List<Note> { new Note { Id = 2, CustomerId = 99 } };
        _mockDataService.Setup(s => s.GetNotesByCustomer(99)).Returns(notes);

        var result = _controller.GetByCustomer(99);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.IsType<List<Note>>(ok.Value);
    }

    [Fact]
    public void TogglePin_ReturnsNotFound_WhenNoteDoesNotExist()
    {
        _mockDataService.Setup(s => s.ToggleNotePin(It.IsAny<long>())).Returns((Note?)null);

        var result = _controller.TogglePin(999);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public void TogglePin_ReturnsOk_WhenNoteExists()
    {
        var note = new Note { Id = 1, IsPinned = true };
        _mockDataService.Setup(s => s.ToggleNotePin(1)).Returns(note);

        var result = _controller.TogglePin(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(note, ok.Value);
    }

    [Fact]
    public void Delete_ReturnsNoContent_WhenSuccessful()
    {
        _mockDataService.Setup(s => s.DeleteNote(It.IsAny<long>()));

        var result = _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public void Delete_Returns500_WhenExceptionThrown()
    {
        _mockDataService.Setup(s => s.DeleteNote(It.IsAny<long>()))
            .Throws(new Exception("DB connection failed"));

        var result = _controller.Delete(1);

        var statusResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(500, statusResult.StatusCode);
    }

    [Fact]
    public void HasAuthorizeAttribute()
    {
        var attrs = typeof(NotesController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true);
        Assert.NotEmpty(attrs);
    }
}
