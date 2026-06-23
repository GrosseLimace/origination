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

public class NotesControllerTests
{
    private readonly Mock<IDataService> _dataServiceMock;
    private readonly Mock<IUserEntitlementService> _entitlementServiceMock;
    private readonly NotesController _sut;

    public NotesControllerTests()
    {
        _dataServiceMock = new Mock<IDataService>();
        _entitlementServiceMock = new Mock<IUserEntitlementService>();
        // Default to the normal "entitlements available" path so GetAll filters rather than
        // failing closed (503). An empty allowed set still passes the test records (null TradeUnit).
        _entitlementServiceMock.Setup(s => s.EntitlementsAvailable).Returns(true);
        _entitlementServiceMock.Setup(s => s.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string>());
        // §8 DEVIATION: the EF in-memory provider is banned for DB tests (automated-testing.md §8) —
        // it doesn't enforce FKs/constraints/SQL semantics. Slated to move onto the real-SQL
        // WebApplicationFactory harness in plan Phase D; only then can the InMemory package be removed.
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(databaseName: $"NotesTest_{Guid.NewGuid()}")
            .Options;
        var appContext = new ApplicationDbContext(options);
        _sut = new NotesController(_dataServiceMock.Object, new Mock<ILogger<NotesController>>().Object, _entitlementServiceMock.Object, appContext);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ReturnsOkWithNotes()
    {
        // Arrange
        var notes = new List<Note>
        {
            new Note { Id = 1, CustomerId = 10, Description = "Test note", IsPinned = false },
            new Note { Id = 2, CustomerId = 10, Description = "Pinned note", IsPinned = true }
        };
        _dataServiceMock.Setup(s => s.GetNotesAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<CancellationToken>())).ReturnsAsync(notes);

        // Act
        var result = await _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<Note>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomer_ReturnsOkWithCustomerNotes()
    {
        // Arrange
        var notes = new List<Note> { new Note { Id = 1, CustomerId = 42, Description = "Note" } };
        _dataServiceMock.Setup(s => s.GetNotesByCustomerAsync(42, It.IsAny<CancellationToken>())).ReturnsAsync(notes);

        // Act
        var result = await _sut.GetByCustomer(42);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<Note>>(ok.Value);
        Assert.Single(returned);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TogglePin_WhenNoteExists_ReturnsOk()
    {
        // Arrange
        var note = new Note { Id = 5, CustomerId = 1, IsPinned = true };
        _dataServiceMock.Setup(s => s.GetNoteByIdAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(note);
        _dataServiceMock.Setup(s => s.ToggleNotePinAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(note);

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
        // Arrange
        _dataServiceMock.Setup(s => s.ToggleNotePinAsync(99, It.IsAny<CancellationToken>())).ReturnsAsync((Note?)null);

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.TogglePin(99));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_WhenNoteExists_ReturnsOk()
    {
        // Arrange
        var note = new Note { Id = 3, CustomerId = 1, Description = "Updated content" };
        _dataServiceMock.Setup(s => s.GetNoteByIdAsync(3, It.IsAny<CancellationToken>())).ReturnsAsync(note);
        _dataServiceMock.Setup(s => s.UpdateNoteAsync(3, "Updated content", It.IsAny<CancellationToken>())).ReturnsAsync(note);
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
        // Arrange
        _dataServiceMock.Setup(s => s.UpdateNoteAsync(99, It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((Note?)null);
        var request = new UpdateNoteRequest { Content = "Some content" };

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.Update(99, request));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_CallsDeleteNote_ReturnsNoContent()
    {
        // Arrange
        _dataServiceMock.Setup(s => s.GetNoteByIdAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new Note { Id = 7, CustomerId = 1, Description = "To delete" });
        _dataServiceMock.Setup(s => s.DeleteNoteAsync(7, It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        // Act
        var result = await _sut.Delete(7);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _dataServiceMock.Verify(s => s.DeleteNoteAsync(7, It.IsAny<CancellationToken>()), Times.Once);
    }
}
