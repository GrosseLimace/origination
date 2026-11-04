// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Pins that the three-year trade-unit ticket walk runs only when something asks for tickets.
/// </summary>
/// <remarks>
/// <para>Until 2026-11-04 the home-page contract load started that walk in the background for every user,
/// so Build-a-List ticket prompts would find it warm. It is the heaviest read the app makes against CTRM
/// (100+ pages for a large trade unit), only those prompts use it, and the IBM i team measured it as the
/// bulk of our load on their database. These tests are the guard against the pre-fetch creeping back: the
/// contract load must leave the ticket reader cold, and Build-a-List's own ticket read must still walk.</para>
/// </remarks>
public class CtrmTicketWalkOnDemandTests
{
    private const string Producer = "TESTPRD";

    /// <summary>Records every document and answers each with one empty page of the type asked for.</summary>
    private sealed class RecordingClient : ICtrmGraphQlClient
    {
        public bool IsConfigured => true;
        public List<string> Documents { get; } = [];

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents) Documents.Add(document);

            object response = typeof(T) == typeof(CtrmContractsResponse)
                ? new CtrmContractsResponse { Contracts = new CtrmPage<CtrmContractDto> { TotalCount = 0, PageInfo = new CtrmPageInfo { HasNextPage = false }, Items = [] } }
                : typeof(T) == typeof(CtrmTicketsResponse)
                    ? new CtrmTicketsResponse { Tickets = new CtrmPage<CtrmTicketDto> { TotalCount = 0, PageInfo = new CtrmPageInfo { HasNextPage = false }, Items = [] } }
                    : throw new InvalidOperationException($"Unexpected response type {typeof(T).Name}.");

            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)response });
        }

        public int TicketDocuments => Documents.Count(d => d.Contains("tickets(", StringComparison.Ordinal));
        public int ContractDocuments => Documents.Count(d => d.Contains("contracts(", StringComparison.Ordinal));
    }

    private static IConfiguration Config() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = "ctrm",
            ["Ctrm:LiveCacheSeconds"] = "0",
            ["Ctrm:TicketLookbackDays"] = "366",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractiveServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0"
        }).Build();

    private static (CtrmContractRepository Contracts, CtrmTicketRepository Tickets, CtrmTicketReader TicketReader, RecordingClient Client) Sut()
    {
        var config = Config();
        var client = new RecordingClient();
        var provenance = new CtrmProvenance();

        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"ondemand-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"ondemand-app-{Guid.NewGuid()}").Options);

        // One producer in one trade unit, so the trade-unit reads resolve to a non-empty producer set and
        // actually reach the client. Without the link they return empty without a call - the wrong path.
        app.Customers.Add(new Customer { Id = 1, ScoularId = Producer, Name = "Test Farm", IsActive = true });
        app.CustomerTradeUnits.Add(new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "2190", IsActive = true });
        app.SaveChanges();

        var contractReader = new CtrmContractReader(client, config, new Mock<ILogger<CtrmContractReader>>().Object);
        var ticketReader = new CtrmTicketReader(client, config, new Mock<ILogger<CtrmTicketReader>>().Object);
        var odsContracts = new ContractRepository(ods, app, new Mock<ILogger<ContractRepository>>().Object);
        var odsTickets = new TicketRepository(ods, app, new Mock<ILogger<TicketRepository>>().Object);

        return (
            new CtrmContractRepository(contractReader, app, odsContracts, provenance, new Mock<ILogger<CtrmContractRepository>>().Object),
            new CtrmTicketRepository(ticketReader, contractReader, app, odsTickets, config, provenance, new Mock<ILogger<CtrmTicketRepository>>().Object),
            ticketReader,
            client);
    }

    [Fact]
    public async Task TheHomePageContractLoadDoesNotStartTheTicketWalk()
    {
        var (contracts, _, ticketReader, client) = Sut();

        await contracts.GetAsync(["2190"], CancellationToken.None);

        // Contracts were read; no ticket document went to the gateway and the ticket reader holds nothing
        // for this set - not even an in-flight walk, which IsWarm would also report.
        Assert.True(client.ContractDocuments > 0);
        Assert.Equal(0, client.TicketDocuments);
        Assert.False(ticketReader.IsWarm([Producer]));
    }

    [Fact]
    public async Task BuildAListsOwnTicketReadStillWalksTheTradeUnit()
    {
        // The other half of the guard: on-demand must still mean "on demand", not "never".
        var (_, tickets, ticketReader, client) = Sut();

        await tickets.GetAsync(["2190"], CancellationToken.None);

        Assert.True(client.TicketDocuments > 0);
        Assert.True(ticketReader.IsWarm([Producer]));
    }
}
