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

/// <summary>
/// Route-level behaviour for personal follow-up reminders. The theme running through the mutation
/// tests: when the service reports it found nothing for this caller, the controller answers 404 —
/// never 403 — so the API cannot be used to discover that another user reminder exists.
/// </summary>
public class RemindersControllerTests
{
    private readonly Mock<IReminderService> _serviceMock = new();
    private readonly RemindersController _sut;

    private static readonly DateTime Due = new(2026, 10, 1, 15, 0, 0, DateTimeKind.Utc);

    public RemindersControllerTests()
    {
        _sut = new RemindersController(_serviceMock.Object, new Mock<ILogger<RemindersController>>().Object);
    }

    private static ReminderResponse Reminder(int id = 1, bool isCompleted = false) => new()
    {
        Id = id,
        CustomerId = 10,
        CustomerName = "Smith Farms",
        CustomerCode = "C-10",
        DueAt = Due,
        Subject = "Follow up with Smith Farms",
        IsCompleted = isCompleted
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomer_ReturnsOkWithReminders()
    {
        // Arrange
        _serviceMock.Setup(s => s.GetByCustomerAsync(10, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync([Reminder(1), Reminder(2)]);

        // Act
        var result = await _sut.GetByCustomer(10);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<ReminderResponse>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    [Fact]
    public async Task GetByCustomer_DefaultsToOpenRemindersOnly()
    {
        // Arrange
        _serviceMock.Setup(s => s.GetByCustomerAsync(It.IsAny<long>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        // Act
        await _sut.GetByCustomer(10);

        // Assert
        _serviceMock.Verify(s => s.GetByCustomerAsync(10, false, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetMine_ReturnsOkWithTheBadgeFeed()
    {
        // Arrange
        _serviceMock.Setup(s => s.GetMineAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([new ReminderDueResponse { Id = 1, CustomerId = 10, CustomerCode = "C-10", DueAt = Due }]);

        // Act
        var result = await _sut.GetMine();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<ReminderDueResponse>>(ok.Value);
        Assert.Equal("C-10", Assert.Single(returned).CustomerCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Create_Returns201WithLocation()
    {
        // Arrange
        var request = new CreateReminderRequest { CustomerId = 10, DueAt = Due };
        _serviceMock.Setup(s => s.CreateAsync(request, It.IsAny<CancellationToken>())).ReturnsAsync(Reminder(7));

        // Act
        var result = await _sut.Create(request);

        // Assert
        var created = Assert.IsType<CreatedResult>(result.Result);
        Assert.Equal("/api/reminders/7", created.Location);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Update_ReturnsOkWhenTheCallerOwnsTheReminder()
    {
        // Arrange
        var request = new UpdateReminderRequest { DueAt = Due, Subject = "Rescheduled" };
        _serviceMock.Setup(s => s.UpdateAsync(1, request, It.IsAny<CancellationToken>())).ReturnsAsync(Reminder(1));

        // Act
        var result = await _sut.Update(1, request);

        // Assert
        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Throws404WhenTheCallerDoesNotOwnTheReminder()
    {
        // Arrange
        var request = new UpdateReminderRequest { DueAt = Due };
        _serviceMock.Setup(s => s.UpdateAsync(99, request, It.IsAny<CancellationToken>())).ReturnsAsync((ReminderResponse?)null);

        // Act + Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.Update(99, request));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SetCompleted_ReturnsOkWithTheUpdatedReminder()
    {
        // Arrange
        _serviceMock.Setup(s => s.SetCompletedAsync(1, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Reminder(1, isCompleted: true));

        // Act
        var result = await _sut.SetCompleted(1, new SetReminderCompletedRequest { IsCompleted = true });

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.True(Assert.IsType<ReminderResponse>(ok.Value).IsCompleted);
    }

    [Fact]
    public async Task SetCompleted_Throws404WhenTheCallerDoesNotOwnTheReminder()
    {
        // Arrange
        _serviceMock.Setup(s => s.SetCompletedAsync(99, true, It.IsAny<CancellationToken>())).ReturnsAsync((ReminderResponse?)null);

        // Act + Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.SetCompleted(99, new SetReminderCompletedRequest { IsCompleted = true }));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SetOutlookEvent_StoresTheEventIdTheClientReportsBack()
    {
        // Arrange
        _serviceMock.Setup(s => s.SetOutlookEventIdAsync(1, "AAMkAD==", It.IsAny<CancellationToken>())).ReturnsAsync(Reminder(1));

        // Act
        var result = await _sut.SetOutlookEvent(1, new SetReminderOutlookEventRequest { OutlookEventId = "AAMkAD==" });

        // Assert
        Assert.IsType<OkObjectResult>(result.Result);
        _serviceMock.Verify(s => s.SetOutlookEventIdAsync(1, "AAMkAD==", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SetOutlookEvent_Throws404WhenTheCallerDoesNotOwnTheReminder()
    {
        // Arrange
        _serviceMock.Setup(s => s.SetOutlookEventIdAsync(99, It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync((ReminderResponse?)null);

        // Act + Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.SetOutlookEvent(99, new SetReminderOutlookEventRequest { OutlookEventId = "x" }));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_Returns204WhenTheReminderWasRemoved()
    {
        // Arrange
        _serviceMock.Setup(s => s.DeleteAsync(1, It.IsAny<CancellationToken>())).ReturnsAsync(true);

        // Act
        var result = await _sut.Delete(1);

        // Assert
        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task Delete_Throws404WhenTheCallerDoesNotOwnTheReminder()
    {
        // Arrange
        _serviceMock.Setup(s => s.DeleteAsync(99, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        // Act + Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.Delete(99));
    }
}
