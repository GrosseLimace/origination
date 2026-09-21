// Microsoft namespaces
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class NotesControllerTests
{
    private readonly Mock<INoteService> _serviceMock;
    private readonly NotesController _sut;

    public NotesControllerTests()
    {
        _serviceMock = new Mock<INoteService>();
        // TradeUnitPreferencesDbContext and the group service are only used by the mention-catalog endpoint,
        // which these tests don't exercise — neither is dereferenced by the methods under test.
        // The request context names the actor in the AUDIT_ log lines (M-041); a stub suffices here.
        var requestContext = new Mock<IRequestContextService>();
        requestContext.Setup(r => r.GetCurrentUser()).Returns("tester");
        _sut = new NotesController(_serviceMock.Object, null!, new Mock<IDailyRecapGroupService>().Object,
            requestContext.Object, new Mock<ILogger<NotesController>>().Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ReturnsOkWithNotes()
    {
        // Arrange
        var notes = new List<NoteResponse>
        {
            new() { Id = 1, CustomerId = 10, Description = "Test note", IsPinned = false },
            new() { Id = 2, CustomerId = 10, Description = "Pinned note", IsPinned = true }
        };
        _serviceMock.Setup(s => s.GetAllAsync(It.IsAny<string?>(), It.IsAny<int?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync(notes);

        // Act
        var result = await _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<NoteResponse>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetLastContact_ReturnsOkWithAggregates()
    {
        // Arrange
        var rows = new List<NoteLastContactResponse>
        {
            new() { CustomerId = 10, CustomerCode = "C10", LastNoteAt = new DateTime(2026, 7, 1) },
            new() { CustomerId = 11, CustomerCode = "C11", LastNoteAt = new DateTime(2026, 6, 15) }
        };
        _serviceMock.Setup(s => s.GetLastContactAsync(It.IsAny<CancellationToken>())).ReturnsAsync(rows);

        // Act
        var result = await _sut.GetLastContact();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<NoteLastContactResponse>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomer_ReturnsOkWithCustomerNotes()
    {
        // Arrange
        var notes = new List<NoteResponse> { new() { Id = 1, CustomerId = 42, Description = "Note" } };
        _serviceMock.Setup(s => s.GetByCustomerAsync(42, It.IsAny<CancellationToken>())).ReturnsAsync(notes);

        // Act
        var result = await _sut.GetByCustomer(42);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<NoteResponse>>(ok.Value);
        Assert.Single(returned);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TogglePin_WhenNoteExists_ReturnsOk()
    {
        // Arrange
        var note = new NoteResponse { Id = 5, CustomerId = 1, IsPinned = true };
        _serviceMock.Setup(s => s.GetByIdAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(note);
        _serviceMock.Setup(s => s.TogglePinAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(note);

        // Act
        var result = await _sut.TogglePin(5);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(note, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TogglePin_WhenNoteNotFound_ThrowsNotFoundException()
    {
        // Arrange — existence check returns null (default), so the controller throws.
        _serviceMock.Setup(s => s.GetByIdAsync(99, It.IsAny<CancellationToken>())).ReturnsAsync((NoteResponse?)null);

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.TogglePin(99));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_WhenNoteExists_ReturnsOk()
    {
        // Arrange
        var note = new NoteResponse { Id = 3, CustomerId = 1, Description = "Updated content" };
        _serviceMock.Setup(s => s.GetByIdAsync(3, It.IsAny<CancellationToken>())).ReturnsAsync(note);
        _serviceMock.Setup(s => s.UpdateAsync(3, "Updated content", It.IsAny<IReadOnlyList<NoteMention>?>(), It.IsAny<CancellationToken>())).ReturnsAsync(note);
        var request = new UpdateNoteRequest { Content = "Updated content" };

        // Act
        var result = await _sut.Update(3, request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(note, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_WhenNoteNotFound_ThrowsNotFoundException()
    {
        // Arrange — existence check returns null (default), so the controller throws.
        _serviceMock.Setup(s => s.GetByIdAsync(99, It.IsAny<CancellationToken>())).ReturnsAsync((NoteResponse?)null);
        var request = new UpdateNoteRequest { Content = "Some content" };

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.Update(99, request));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_CallsDeleteNote_ReturnsNoContent()
    {
        // Arrange
        _serviceMock.Setup(s => s.GetByIdAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new NoteResponse { Id = 7, CustomerId = 1, Description = "To delete" });
        _serviceMock.Setup(s => s.DeleteAsync(7, It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        // Act
        var result = await _sut.Delete(7);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _serviceMock.Verify(s => s.DeleteAsync(7, It.IsAny<CancellationToken>()), Times.Once);
    }
}
