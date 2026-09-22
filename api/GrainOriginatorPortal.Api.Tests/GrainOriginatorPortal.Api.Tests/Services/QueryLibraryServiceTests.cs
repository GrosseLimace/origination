// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The search log is free-text typed by originators and is later shown to admins on the usage
/// dashboard query-gap view, so PII redaction happens HERE, before persistence; the repository
/// stores whatever it is handed. These pin the redaction, the audit stamp, and the read mapping.
/// </summary>
public class QueryLibraryServiceTests
{
    private const string CurrentUser = "cegr@scoular.com";

    private readonly Mock<IQueryLibraryRepository> _repositoryMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly QueryLibraryService _sut;

    public QueryLibraryServiceTests()
    {
        _requestContextMock.Setup(r => r.GetCurrentUser()).Returns(CurrentUser);
        _sut = new QueryLibraryService(_repositoryMock.Object, _requestContextMock.Object);
    }

    [Fact]
    public async Task GetAllAsync_MapsActiveItemsToResponses()
    {
        var created = new DateTime(2026, 1, 15, 0, 0, 0, DateTimeKind.Utc);
        _repositoryMock
            .Setup(r => r.GetActiveAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<QueryLibraryItem>
            {
                new()
                {
                    Id = 3, Category = "Contracts", Name = "Active contracts", Description = "Producers with an open purchase contract",
                    QueryText = "producers with active contracts", Tags = "contracts,open", SortOrder = 2, IsActive = true,
                    CreatedAt = created, ModifiedAt = null,
                },
            });

        var result = await _sut.GetAllAsync(CancellationToken.None);

        var item = Assert.Single(result);
        Assert.Equal(3, item.Id);
        Assert.Equal("Contracts", item.Category);
        Assert.Equal("Active contracts", item.Name);
        Assert.Equal("Producers with an open purchase contract", item.Description);
        Assert.Equal("producers with active contracts", item.QueryText);
        Assert.Equal("contracts,open", item.Tags);
        Assert.Equal(2, item.SortOrder);
        Assert.True(item.IsActive);
        Assert.Equal(created, item.CreatedAt);
        Assert.Null(item.ModifiedAt);
    }

    [Fact]
    public async Task GetAllAsync_WhenNothingIsActive_ReturnsEmpty()
    {
        _repositoryMock.Setup(r => r.GetActiveAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new List<QueryLibraryItem>());

        var result = await _sut.GetAllAsync(CancellationToken.None);

        Assert.Empty(result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(7)]
    public async Task LogSearchAsync_StampsTheCurrentUserAUtcTimestampAndTheMatchedQuery(int? matchedQueryId)
    {
        var captured = CaptureLog();
        var before = DateTime.UtcNow;

        await _sut.LogSearchAsync("producers with corn contracts", matchedQueryId, CancellationToken.None);

        var log = Assert.Single(captured);
        Assert.Equal(CurrentUser, log.UserId);
        Assert.Equal(matchedQueryId, log.MatchedQueryId);
        Assert.Equal("producers with corn contracts", log.SearchText); // plain terms survive intact
        Assert.InRange(log.Timestamp, before, DateTime.UtcNow.AddSeconds(5));
    }

    [Fact]
    public async Task LogSearchAsync_RedactsEmailsPhonesAndLongDigitRunsButKeepsTheSearchTerms()
    {
        var captured = CaptureLog();

        await _sut.LogSearchAsync(
            "call john.doe@farm.com or (402) 555-1234 about acct 12345678 corn basis", null, CancellationToken.None);

        var stored = Assert.Single(captured).SearchText;
        Assert.DoesNotContain("john.doe@farm.com", stored);
        Assert.DoesNotContain("555-1234", stored);
        Assert.DoesNotContain("12345678", stored);
        Assert.Contains("[redacted-email]", stored);
        Assert.Contains("[redacted-phone]", stored);
        Assert.Contains("[redacted-number]", stored);
        Assert.Contains("corn basis", stored); // gap analysis still has the actual search intent
    }

    // Trade-unit codes and other short numbers are legitimate search input; only 7+ digit runs
    // (unformatted phones / account numbers) are masked.
    [Fact]
    public async Task LogSearchAsync_LeavesShortNumbersSuchAsTradeUnitCodesIntact()
    {
        var captured = CaptureLog();

        await _sut.LogSearchAsync("unapplied tickets in 2090 since 2025", null, CancellationToken.None);

        Assert.Equal("unapplied tickets in 2090 since 2025", Assert.Single(captured).SearchText);
    }

    [Fact]
    public async Task LogSearchAsync_WhenTheSearchTextIsEmpty_PersistsItAsIs()
    {
        var captured = CaptureLog();

        await _sut.LogSearchAsync(string.Empty, null, CancellationToken.None);

        Assert.Equal(string.Empty, Assert.Single(captured).SearchText);
    }

    private List<QuerySearchLog> CaptureLog()
    {
        var captured = new List<QuerySearchLog>();
        _repositoryMock
            .Setup(r => r.AddSearchLogAsync(It.IsAny<QuerySearchLog>(), It.IsAny<CancellationToken>()))
            .Callback<QuerySearchLog, CancellationToken>((log, _) => captured.Add(log))
            .Returns(Task.CompletedTask);
        return captured;
    }
}
