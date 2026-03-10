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

public class NotesControllerTests
{
    private readonly Mock<IDataService> _dataServiceMock;
    private readonly NotesController _sut;

    public NotesControllerTests()
    {
        _dataServiceMock = new Mock<IDataService>();
        _sut = new NotesController(_dataServiceMock.Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetAll_ReturnsOkWithNotes()
    {
        // Arrange
        var notes = new List<Note>
        {
            new Note { Id = 1, CustomerId = 10, Description = "Test note", IsPinned = false },
            new Note { Id = 2, CustomerId = 10, Description = "Pinned note", IsPinned = true }
        };
        _dataServiceMock.Setup(s => s.GetNotes()).Returns(notes);

        // Act
        var result = _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<Note>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetByCustomer_ReturnsOkWithCustomerNotes()
    {
        // Arrange
        var notes = new List<Note> { new Note { Id = 1, CustomerId = 42, Description = "Note" } };
        _dataServiceMock.Setup(s => s.GetNotesByCustomer(42)).Returns(notes);

        // Act
        var result = _sut.GetByCustomer(42);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<Note>>(ok.Value);
        Assert.Single(returned);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TogglePin_WhenNoteExists_ReturnsOk()
    {
        // Arrange
        var note = new Note { Id = 5, CustomerId = 1, IsPinned = true };
        _dataServiceMock.Setup(s => s.ToggleNotePin(5)).Returns(note);

        // Act
        var result = _sut.TogglePin(5);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(note, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TogglePin_WhenNoteNotFound_ReturnsNotFound()
    {
        // Arrange
        _dataServiceMock.Setup(s => s.ToggleNotePin(99)).Returns((Note?)null);

        // Act
        var result = _sut.TogglePin(99);

        // Assert
        Assert.IsType<NotFoundResult>(result.Result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Update_WhenNoteExists_ReturnsOk()
    {
        // Arrange
        var note = new Note { Id = 3, CustomerId = 1, Description = "Updated content" };
        _dataServiceMock.Setup(s => s.UpdateNote(3, "Updated content")).Returns(note);
        var request = new UpdateNoteRequest { Content = "Updated content" };

        // Act
        var result = _sut.Update(3, request);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(note, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Update_WhenNoteNotFound_ReturnsNotFound()
    {
        // Arrange
        _dataServiceMock.Setup(s => s.UpdateNote(99, It.IsAny<string>())).Returns((Note?)null);
        var request = new UpdateNoteRequest { Content = "Some content" };

        // Act
        var result = _sut.Update(99, request);

        // Assert
        Assert.IsType<NotFoundResult>(result.Result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Delete_CallsDeleteNote_ReturnsNoContent()
    {
        // Arrange
        _dataServiceMock.Setup(s => s.DeleteNote(7));

        // Act
        var result = _sut.Delete(7);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _dataServiceMock.Verify(s => s.DeleteNote(7), Times.Once);
    }
}
