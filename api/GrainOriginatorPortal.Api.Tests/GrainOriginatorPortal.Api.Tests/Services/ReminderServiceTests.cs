// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers what <see cref="ReminderService"/> adds on top of the repository: it supplies the caller
/// identity so no route can act as another user, refuses follow-ups scheduled in the past, and
/// fills in a sensible subject when the user did not type one.
///
/// The owner-scoping assertions here are about the SERVICE never inventing an owner — that it
/// always passes the current user through. Whether a foreign row is actually unreachable is proven
/// against a database in ReminderRepositoryTests.
/// </summary>
public class ReminderServiceTests
{
    private const string Caller = "alice@scoular.com";

    private static readonly DateTime FutureDue = DateTime.UtcNow.AddDays(7);

    private readonly Mock<IReminderRepository> _repository = new();
    private readonly Mock<ICustomerRepository> _customers = new();
    private readonly Mock<IRequestContextService> _requestContext = new();
    private readonly ReminderService _sut;

    public ReminderServiceTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns(Caller);
        _customers.Setup(c => c.GetByIdAsync(10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Customer { Id = 10, Name = "Smith Farms", ScoularId = "C-10" });
        _repository
            .Setup(r => r.AddAsync(It.IsAny<long>(), It.IsAny<DateTime>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((long customerId, DateTime due, string subject, string? notes, string owner, CancellationToken _) =>
                new ProducerReminder
                {
                    Id = 1,
                    CustomerId = customerId,
                    DueAt = due,
                    Subject = subject,
                    Notes = notes,
                    CreatedBy = owner,
                    CustomerName = "Smith Farms",
                    CustomerCode = "C-10"
                });

        _sut = new ReminderService(_repository.Object, _customers.Object, _requestContext.Object);
    }

    private static CreateReminderRequest CreateRequest(DateTime? dueAt = null, string? subject = null, string? notes = null) =>
        new() { CustomerId = 10, DueAt = dueAt ?? FutureDue, Subject = subject, Notes = notes };

    // ── The caller identity is always the one used ───────────────────────────
    [Fact]
    public async Task CreateAsync_StampsTheCurrentUserAsOwner()
    {
        // Act
        await _sut.CreateAsync(CreateRequest(), CancellationToken.None);

        // Assert
        _repository.Verify(r => r.AddAsync(10, It.IsAny<DateTime>(), It.IsAny<string>(), It.IsAny<string?>(), Caller, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetMineAsync_AsksTheRepositoryForTheCurrentUserOwnReminders()
    {
        // Arrange
        _repository.Setup(r => r.GetOpenForOwnerAsync(Caller, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new ProducerReminder { Id = 3, CustomerId = 10, CustomerCode = "C-10", DueAt = FutureDue }]);

        // Act
        var feed = await _sut.GetMineAsync(CancellationToken.None);

        // Assert
        var row = Assert.Single(feed);
        Assert.Equal(3, row.Id);
        Assert.Equal("C-10", row.CustomerCode);
        _repository.Verify(r => r.GetOpenForOwnerAsync(Caller, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task GetByCustomerAsync_PassesTheCallerAndTheCompletedFlagThrough(bool includeCompleted)
    {
        // Arrange
        _repository.Setup(r => r.GetByCustomerAsync(10, Caller, includeCompleted, It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        // Act
        await _sut.GetByCustomerAsync(10, includeCompleted, CancellationToken.None);

        // Assert
        _repository.Verify(r => r.GetByCustomerAsync(10, Caller, includeCompleted, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsNullWhenTheCallerDoesNotOwnTheReminder()
    {
        // Arrange — the repository reports "no such row for this owner".
        _repository.Setup(r => r.GetByIdAsync(99, Caller, It.IsAny<CancellationToken>()))
            .ReturnsAsync((ProducerReminder?)null);

        // Act
        var result = await _sut.UpdateAsync(99, new UpdateReminderRequest { DueAt = FutureDue }, CancellationToken.None);

        // Assert — and crucially, no write was attempted.
        Assert.Null(result);
        _repository.Verify(
            r => r.UpdateAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task DeleteAsync_ScopesTheDeleteToTheCurrentUser()
    {
        // Arrange
        _repository.Setup(r => r.DeleteAsync(5, Caller, It.IsAny<CancellationToken>())).ReturnsAsync(true);

        // Act
        var deleted = await _sut.DeleteAsync(5, CancellationToken.None);

        // Assert
        Assert.True(deleted);
        _repository.Verify(r => r.DeleteAsync(5, Caller, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AdminRoleGrantsNoExtraReach()
    {
        // Arrange — an admin is just another user here; there is no override path.
        _requestContext.Setup(r => r.IsAdmin()).Returns(true);
        _repository.Setup(r => r.GetByIdAsync(7, Caller, It.IsAny<CancellationToken>()))
            .ReturnsAsync((ProducerReminder?)null);

        // Act
        var result = await _sut.UpdateAsync(7, new UpdateReminderRequest { DueAt = FutureDue }, CancellationToken.None);

        // Assert
        Assert.Null(result);
        _requestContext.Verify(r => r.IsAdmin(), Times.Never);
    }

    // ── Due-date validation ──────────────────────────────────────────────────
    [Fact]
    public async Task CreateAsync_RejectsADueDateWellInThePast()
    {
        // Act + Assert
        var ex = await Assert.ThrowsAsync<ValidationException>(
            () => _sut.CreateAsync(CreateRequest(dueAt: DateTime.UtcNow.AddDays(-3)), CancellationToken.None));
        Assert.True(ex.Errors.ContainsKey("dueAt"));
    }

    [Fact]
    public async Task CreateAsync_AllowsEarlierToday()
    {
        // Arrange — picking "today 9:00" in the afternoon is normal, not a mistake.
        var earlierToday = DateTime.UtcNow.AddHours(-4);

        // Act
        var created = await _sut.CreateAsync(CreateRequest(dueAt: earlierToday), CancellationToken.None);

        // Assert
        Assert.Equal(earlierToday, created.DueAt);
    }

    [Fact]
    public async Task CreateAsync_TreatsAnUnspecifiedKindDueDateAsUtc()
    {
        // Arrange — an unzoned literal must not be shifted by the server local zone.
        var unspecified = DateTime.SpecifyKind(DateTime.UtcNow.AddDays(3), DateTimeKind.Unspecified);

        // Act
        var created = await _sut.CreateAsync(CreateRequest(dueAt: unspecified), CancellationToken.None);

        // Assert
        Assert.Equal(DateTimeKind.Utc, created.DueAt.Kind);
        Assert.Equal(unspecified, created.DueAt, TimeSpan.FromSeconds(1));
    }

    // ── Subject and notes ────────────────────────────────────────────────────
    [Fact]
    public async Task CreateAsync_FallsBackToAProducerNamedSubject()
    {
        // Act
        var created = await _sut.CreateAsync(CreateRequest(subject: "   "), CancellationToken.None);

        // Assert
        Assert.Equal("Follow up with Smith Farms", created.Subject);
    }

    [Fact]
    public async Task CreateAsync_KeepsTheSubjectTheUserTyped()
    {
        // Act
        var created = await _sut.CreateAsync(CreateRequest(subject: "  Discuss fall basis  "), CancellationToken.None);

        // Assert
        Assert.Equal("Discuss fall basis", created.Subject);
    }

    [Fact]
    public async Task CreateAsync_NormalizesBlankNotesToNull()
    {
        // Act
        var created = await _sut.CreateAsync(CreateRequest(notes: "   "), CancellationToken.None);

        // Assert
        Assert.Null(created.Notes);
    }

    [Fact]
    public async Task CreateAsync_ThrowsNotFoundWhenTheProducerDoesNotExist()
    {
        // Arrange
        _customers.Setup(c => c.GetByIdAsync(404, It.IsAny<CancellationToken>())).ReturnsAsync((Customer?)null);
        var request = new CreateReminderRequest { CustomerId = 404, DueAt = FutureDue };

        // Act + Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.CreateAsync(request, CancellationToken.None));
    }

    // ── Outlook linkage ──────────────────────────────────────────────────────
    [Fact]
    public async Task SetOutlookEventIdAsync_TreatsABlankIdAsClearingTheLink()
    {
        // Arrange
        _repository.Setup(r => r.SetOutlookEventIdAsync(1, Caller, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ProducerReminder { Id = 1, CustomerId = 10, Subject = "s", DueAt = FutureDue });

        // Act
        await _sut.SetOutlookEventIdAsync(1, "  ", CancellationToken.None);

        // Assert
        _repository.Verify(r => r.SetOutlookEventIdAsync(1, Caller, null, It.IsAny<CancellationToken>()), Times.Once);
    }
}
