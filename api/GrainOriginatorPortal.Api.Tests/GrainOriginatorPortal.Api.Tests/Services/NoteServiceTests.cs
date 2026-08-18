// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class NoteServiceTests
{
    private readonly Mock<INoteRepository> _repositoryMock = new();
    private readonly Mock<ICustomerRepository> _customerRepositoryMock = new();
    private readonly Mock<IDisplayNameLookupRepository> _displayNameMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly Mock<IDailyRecapGroupService> _groupsMock = new();
    private readonly NoteService _sut;

    public NoteServiceTests()
    {
        _displayNameMock
            .Setup(d => d.ResolveAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        // Groups are only consulted when a note carries an "app-group" mention; these tests don't.
        _groupsMock
            .Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        // NoteService no longer depends on IUserEntitlementService — note reads are not
        // entitlement-gated (trade units scope producers, not notes; AR-02).
        _sut = new NoteService(
            _repositoryMock.Object,
            _customerRepositoryMock.Object,
            _displayNameMock.Object,
            _requestContextMock.Object,
            _groupsMock.Object,
            new Mock<ILogger<NoteService>>().Object);
    }

    // -------------------------------------------------------------------------
    // The badge aggregate maps the repo's rows 1:1 — no entitlement gate (notes are open per
    // producer, AR-02, same as the per-customer endpoint).
    [Fact]
    public async Task GetLastContactAsync_MapsRows()
    {
        // Arrange
        _repositoryMock
            .Setup(r => r.GetLastContactAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<NoteLastContact>
            {
                new() { CustomerId = 7, CustomerCode = "C7", LastNoteAt = new DateTime(2026, 7, 10) },
                new() { CustomerId = 8, CustomerCode = "C8", LastNoteAt = new DateTime(2026, 6, 1) }
            });

        // Act
        var result = await _sut.GetLastContactAsync(CancellationToken.None);

        // Assert — rows map 1:1 onto the response shape.
        Assert.Equal(2, result.Count);
        Assert.Equal(7, result[0].CustomerId);
        Assert.Equal("C7", result[0].CustomerCode);
        Assert.Equal(new DateTime(2026, 7, 10), result[0].LastNoteAt);
    }

    // -------------------------------------------------------------------------
    // GetAllAsync returns the repo's notes mapped, with no entitlement filter on the notes.
    [Fact]
    public async Task GetAllAsync_ReturnsAllNotes_NoEntitlementFilter()
    {
        // Arrange — notes tagged to a mix of trade units (including one the caller would not be
        // "entitled" to) all come back; the trade-unit tag is not a visibility filter.
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<DateTime?>(), It.IsAny<IReadOnlyList<string>?>(), It.IsAny<IReadOnlyList<string>?>(), It.IsAny<bool>(), It.IsAny<IReadOnlyList<long>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Note>
            {
                new() { Id = 1, CustomerId = 10, TradeUnit = "1084", Description = "a", CreatedBy = "u@x" },
                new() { Id = 2, CustomerId = 11, TradeUnit = "9999", Description = "b", CreatedBy = "u@x" },
                new() { Id = 3, CustomerId = 12, TradeUnit = null,   Description = "c", CreatedBy = "u@x" }
            });

        // Act
        var result = await _sut.GetAllAsync(null, null, null, null, false, null, CancellationToken.None);

        // Assert — every note is returned regardless of its TradeUnit tag.
        Assert.Equal(3, result.Count);
    }
}
