using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Interfaces;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;

namespace GrainOriginatorPortal.Api.Tests;

public class NotesControllerTests
{
    private readonly Mock<IDataService> _mockDataService;
    private readonly Mock<ILogger<NotesController>> _mockLogger;
    private readonly Mock<IUserEntitlementService> _mockEntitlementService;
    private readonly ApplicationDbContext _appContext;
    private readonly NotesController _controller;

    public NotesControllerTests()
    {
        _mockDataService = new Mock<IDataService>();
        _mockLogger = new Mock<ILogger<NotesController>>();
        _mockEntitlementService = new Mock<IUserEntitlementService>();
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(databaseName: $"NotesTest_{Guid.NewGuid()}")
            .Options;
        _appContext = new ApplicationDbContext(options);
        _controller = new NotesController(_mockDataService.Object, _mockLogger.Object, _mockEntitlementService.Object, _appContext);
    }

    [Fact]
    public async Task GetAll_ReturnsOkWithNotes()
    {
        var notes = new List<Note> { new Note { Id = 1, Description = "Test note" } };
        _mockDataService
            .Setup(s => s.GetNotesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(notes);

        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<Note>>(ok.Value);
        Assert.Single(returned);
    }

    [Fact]
    public async Task GetByCustomer_ReturnsOkWithNotes()
    {
        var notes = new List<Note> { new Note { Id = 2, CustomerId = 99 } };
        _mockDataService
            .Setup(s => s.GetNotesByCustomerAsync(99, It.IsAny<CancellationToken>()))
            .ReturnsAsync(notes);

        var result = await _controller.GetByCustomer(99);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.IsType<List<Note>>(ok.Value);
    }

    [Fact]
    public async Task TogglePin_ThrowsNotFoundException_WhenNoteDoesNotExist()
    {
        _mockDataService
            .Setup(s => s.ToggleNotePinAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Note?)null);

        await Assert.ThrowsAsync<NotFoundException>(() => _controller.TogglePin(999));
    }

    [Fact]
    public async Task TogglePin_ReturnsOk_WhenNoteExists()
    {
        var note = new Note { Id = 1, CustomerId = 99, IsPinned = true };
        _mockDataService
            .Setup(s => s.GetNoteByIdAsync(1, It.IsAny<CancellationToken>()))
            .ReturnsAsync(note);
        _mockEntitlementService
            .Setup(s => s.ValidateCustomerAccessAsync(99, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _mockDataService
            .Setup(s => s.ToggleNotePinAsync(1, It.IsAny<CancellationToken>()))
            .ReturnsAsync(note);

        var result = await _controller.TogglePin(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(note, ok.Value);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccessful()
    {
        var note = new Note { Id = 1, CustomerId = 99 };
        _mockDataService
            .Setup(s => s.GetNoteByIdAsync(1, It.IsAny<CancellationToken>()))
            .ReturnsAsync(note);
        _mockEntitlementService
            .Setup(s => s.ValidateCustomerAccessAsync(99, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _mockDataService
            .Setup(s => s.DeleteNoteAsync(1, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var result = await _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task Delete_ThrowsException_WhenServiceFails()
    {
        var note = new Note { Id = 1, CustomerId = 99 };
        _mockDataService
            .Setup(s => s.GetNoteByIdAsync(1, It.IsAny<CancellationToken>()))
            .ReturnsAsync(note);
        _mockEntitlementService
            .Setup(s => s.ValidateCustomerAccessAsync(99, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _mockDataService
            .Setup(s => s.DeleteNoteAsync(1, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Exception("DB connection failed"));

        await Assert.ThrowsAsync<Exception>(() => _controller.Delete(1));
    }

}
