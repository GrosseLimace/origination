// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// TicketService.SafeFetchAsync has THREE catch arms whose order matters: SQL 207/208 to [], any
/// other SqlException (even wrapped) to a retryable 503, EF mapping errors to []. A wrapped
/// SqlException arrives as an InvalidOperationException, which the mapping arm would also accept,
/// so the SQL arm must come first or a timeout silently becomes an empty ticket list again.
/// These pin the arms, their order, and the derived IsApplied/ParsedDate values on the response.
/// </summary>
public class TicketServiceTests
{
    private readonly Mock<ITicketRepository> _repositoryMock = new();
    private readonly TicketService _sut;

    public TicketServiceTests()
    {
        _sut = new TicketService(_repositoryMock.Object, new Mock<ILogger<TicketService>>().Object);
    }

    [Fact]
    public async Task GetAllAsync_MapsTicketsIncludingTheDerivedIsAppliedAndParsedDate()
    {
        var tradeUnits = new List<string> { "2090" };
        _repositoryMock
            .Setup(r => r.GetAsync(tradeUnits, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new Ticket { Id = 1, TicketNumber = "364877", CustomerCode = "C7", CtrmContractNumber = "P123456", Date = "2026-09-01", AppliedDockQuantity = 812L, NetWeight = 45_500 },
                new Ticket { Id = 2, TicketNumber = "364878", CtrmContractNumber = "U000001", Date = "not a date" },
                new Ticket { Id = 3, TicketNumber = "364879", CtrmContractNumber = "C000002", Date = null },
                new Ticket { Id = 4, TicketNumber = "364880", CtrmContractNumber = null },
            ]);

        var result = await _sut.GetAllAsync(tradeUnits, CancellationToken.None);

        Assert.Equal(4, result.Count);
        Assert.Equal("364877", result[0].TicketNumber);
        Assert.Equal("C7", result[0].CustomerCode);
        Assert.Equal(812L, result[0].AppliedDockQuantity);
        Assert.Equal(45_500, result[0].NetWeight);
        Assert.True(result[0].IsApplied);                              // P = purchase contract
        Assert.Equal(new DateTime(2026, 9, 1), result[0].ParsedDate);  // TicketBlDate is a string in ODS
        Assert.False(result[1].IsApplied);                             // U = unload, no contract yet
        Assert.Null(result[1].ParsedDate);                             // unparseable string is null, not a throw
        Assert.False(result[2].IsApplied);                             // C = customer storage, shown as unapplied
        Assert.Null(result[2].ParsedDate);
        Assert.True(result[3].IsApplied);                              // no contract number counts as applied
    }

    [Theory]
    [InlineData(207)] // invalid column name
    [InlineData(208)] // invalid object name
    public async Task GetAllAsync_WhenTheViewIsMissingAMappedColumnOrObject_DegradesToEmpty(int sqlErrorNumber)
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.WithNumber(sqlErrorNumber));

        var result = await _sut.GetAllAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetAllAsync_WhenTheDatabaseTimesOut_SurfacesARetryable503WithTheCauseAttached()
    {
        var sqlException = SqlExceptionDoubles.Transient();
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(sqlException);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("TICKETS_DB_UNAVAILABLE", ex.ErrorCode);
        Assert.Equal(503, ex.HttpStatusCode);
        Assert.Same(sqlException, ex.InnerException);
    }

    // Catch-arm ORDER: InvalidOperationException matches the EF-mapping arm too. With a SqlException
    // inside it, the SQL arm must win, otherwise a wrapped timeout degrades to [] again.
    [Fact]
    public async Task GetAllAsync_WhenAnInvalidOperationExceptionWrapsASqlException_TheSqlArmWinsAndSurfacesA503()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("An error occurred while reading", SqlExceptionDoubles.Transient()));

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("TICKETS_DB_UNAVAILABLE", ex.ErrorCode);
    }

    // AppliedNetQuantity is bigint and TicketBlDate is a string in ODS; a type drift on either shows
    // up as one of these three from EF, and the page must render (empty) rather than 500.
    [Theory]
    [InlineData(typeof(InvalidCastException))]
    [InlineData(typeof(InvalidOperationException))]
    [InlineData(typeof(OverflowException))]
    public async Task GetAllAsync_WhenEfCoreMappingFails_DegradesToEmpty(Type exceptionType)
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync((Exception)Activator.CreateInstance(exceptionType, "ODS schema mismatch")!);

        var result = await _sut.GetAllAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    // Everything else is a programming error and must surface, not hide behind an empty list.
    [Fact]
    public async Task GetAllAsync_WhenAnUnrelatedExceptionIsThrown_PropagatesItUnchanged()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ArgumentNullException("tradeUnits"));

        await Assert.ThrowsAsync<ArgumentNullException>(() => _sut.GetAllAsync(null, CancellationToken.None));
    }

    [Fact]
    public async Task SafeWrappers_ForwardTheirArgumentsToTheRepository()
    {
        var tradeUnits = new List<string> { "2090" };
        _repositoryMock.Setup(r => r.GetTodaysAsync(tradeUnits, It.IsAny<CancellationToken>())).ReturnsAsync([new Ticket { Id = 1 }]);
        _repositoryMock.Setup(r => r.GetByCustomerAsync(42L, "SC-42", It.IsAny<CancellationToken>())).ReturnsAsync([new Ticket { Id = 2 }]);
        _repositoryMock.Setup(r => r.GetUnappliedByCustomerAsync(42L, null, It.IsAny<CancellationToken>())).ReturnsAsync([new Ticket { Id = 3 }]);
        _repositoryMock.Setup(r => r.GetAppliedByContractAsync("P123456", It.IsAny<CancellationToken>())).ReturnsAsync([new Ticket { Id = 4 }]);
        _repositoryMock.Setup(r => r.GetByFarmAsync("farm-1", It.IsAny<CancellationToken>())).ReturnsAsync([new Ticket { Id = 5 }]);

        Assert.Equal(1, Assert.Single(await _sut.GetTodaysAsync(tradeUnits, CancellationToken.None)).Id);
        Assert.Equal(2, Assert.Single(await _sut.GetByCustomerAsync(42L, "SC-42", CancellationToken.None)).Id);
        Assert.Equal(3, Assert.Single(await _sut.GetUnappliedByCustomerAsync(42L, null, CancellationToken.None)).Id);
        Assert.Equal(4, Assert.Single(await _sut.GetAppliedByContractAsync("P123456", CancellationToken.None)).Id);
        Assert.Equal(5, Assert.Single(await _sut.GetByFarmAsync("farm-1", CancellationToken.None)).Id);
    }

    // Every read goes through the same wrapper, so the 503 contract holds on the per-producer
    // routes too, not just the bulk list.
    [Fact]
    public async Task GetUnappliedByCustomerAsync_WhenTheDatabaseTimesOut_SurfacesA503()
    {
        _repositoryMock
            .Setup(r => r.GetUnappliedByCustomerAsync(It.IsAny<long>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.Transient());

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetUnappliedByCustomerAsync(42L, "SC-42", CancellationToken.None));

        Assert.Equal("TICKETS_DB_UNAVAILABLE", ex.ErrorCode);
    }
}
