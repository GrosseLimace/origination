using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Repositories;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The field plan's 45Z ticket read: the producer's tickets, every party's row under the field's split ID kept,
/// and the contract crop years of every party on those rows. Over a faked CTRM GraphQL client.
/// </summary>
public class CtrmFieldTicketReaderTests
{
    private const string Producer = "TESTPRD";
    private const string Partner = "LANDLRD";
    private const string Split = "TESTP02";

    /// <summary>Answers ticket documents with the given headers, and contract documents per customer.</summary>
    private sealed class FakeClient(List<CtrmTicketDto> tickets, Dictionary<string, List<CtrmContractDto>?> contracts) : ICtrmGraphQlClient
    {
        public bool IsConfigured => true;
        public List<string> TicketDocuments { get; } = [];
        public List<string> ContractCustomers { get; } = [];

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            if (typeof(T) == typeof(CtrmTicketsResponse))
            {
                TicketDocuments.Add(document);
                var page = new CtrmTicketsResponse
                {
                    Tickets = new CtrmPage<CtrmTicketDto> { TotalCount = tickets.Count, PageInfo = new CtrmPageInfo { HasNextPage = false }, Items = tickets },
                };
                return Ok<T>(page);
            }

            var code = Regex.Match(JsonSerializer.Serialize(variables), "\"customerId\":\"([^\"]+)\"").Groups[1].Value;
            ContractCustomers.Add(code);
            if (!contracts.TryGetValue(code, out var list) || list is null)
                return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.EgressBlocked, Detail = "unreachable" });
            return Ok<T>(new CtrmContractsResponse
            {
                Contracts = new CtrmPage<CtrmContractDto> { TotalCount = list.Count, PageInfo = new CtrmPageInfo { HasNextPage = false }, Items = list },
            });
        }

        private static Task<CtrmReadResult<T>> Ok<T>(object value) =>
            Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)value });
    }

    private static IConfiguration Config() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = "ctrm",
            ["Ctrm:LiveCacheSeconds"] = "0",
            ["Ctrm:TicketLookbackDays"] = "366",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractiveServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
        }).Build();

    private static CtrmFieldTicketReader Reader(FakeClient client, string? scoularId = Producer)
    {
        var config = Config();
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"field-tickets-app-{Guid.NewGuid()}").Options);
        app.Customers.Add(new Customer { Id = 1, ScoularId = scoularId, Name = "Test Farm", IsActive = true });
        app.SaveChanges();
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"field-tickets-ods-{Guid.NewGuid()}").Options);
        return new CtrmFieldTicketReader(
            new CtrmTicketReader(client, config, new Mock<ILogger<CtrmTicketReader>>().Object),
            new CtrmContractReader(client, config, new Mock<ILogger<CtrmContractReader>>().Object),
            new TicketRepository(ods, app, new Mock<ILogger<TicketRepository>>().Object),
            app,
            new Mock<ILogger<CtrmFieldTicketReader>>().Object);
    }

    private static CtrmTicketDetailDto Row(string customerCode, string? split, int sequence, string contract) => new()
    {
        CustomerCode = customerCode,
        CombinedCustomerId = split,
        ContractNumber = contract,
        CancelFlag = "N",
        TicketSequenceNumber = sequence,
        AppliedNetQuantity = 10_000m * sequence,
        OrganizationCode = "2190",
        ElevatorCode = "01",
        TicketType = "P",
    };

    /// <summary>One split load (producer and landlord rows under the split) plus the producer's row for another split.</summary>
    private static List<CtrmTicketDto> Tickets() =>
    [
        new()
        {
            TicketPrefix = "T", TicketNumber = "100001", TicketSuffix = "", TicketBLDate = DateTime.Today.AddDays(-30),
            ProductCode = "YC", ShipmentTicketNumber = "T100001", UnloadQuantity = 60_000m,
            Details =
            [
                Row(Producer, Split, 1, "PWW000001"),
                Row(Partner, " testp02 ", 2, "PWW000002"),
                Row(Producer, "TESTP16", 3, "PWW000003"),
            ],
        },
    ];

    [Fact]
    public async Task KeepsEveryPartysRowUnderTheSplit_WithEachPartysContractYears()
    {
        var client = new FakeClient(Tickets(), new()
        {
            [Producer] = [new CtrmContractDto { ContractNumber = "pww000001 ", CropYear = 2025 }],
            [Partner] = [new CtrmContractDto { ContractNumber = "PWW000002", CropYear = 2026 }],
        });

        var read = await Reader(client).ReadAsync(1, Split, default);

        Assert.True(read.Ok);
        Assert.Equal([Producer, Partner], read.Value!.Tickets.Select(t => t.CustomerCode));
        Assert.Equal(2025, read.Value.ContractCropYears["PWW000001"]);
        Assert.Equal(2026, read.Value.ContractCropYears["PWW000002"]);
        Assert.Equal([Producer, Partner], client.ContractCustomers);
        Assert.All(client.TicketDocuments, d => Assert.Equal(CtrmQueries.TicketsBySplitProducer, d));
    }

    [Fact]
    public async Task APartysContractsUnavailable_LeavesItsTicketsToTheDateWindow()
    {
        var client = new FakeClient(Tickets(), new()
        {
            [Producer] = [new CtrmContractDto { ContractNumber = "PWW000001", CropYear = 2025 }],
            [Partner] = null,
        });

        var read = await Reader(client).ReadAsync(1, Split, default);

        Assert.True(read.Ok);
        Assert.Equal(2, read.Value!.Tickets.Count);
        Assert.False(read.Value.ContractCropYears.ContainsKey("PWW000002"));
    }

    [Fact]
    public async Task NoProducerCode_IsAFailedRead_NotNoTickets()
    {
        var client = new FakeClient(Tickets(), new());

        var read = await Reader(client, scoularId: null).ReadAsync(1, Split, default);

        Assert.False(read.Ok);
        Assert.Equal(CtrmReadStatus.Error, read.Status);
        Assert.Empty(client.TicketDocuments);
    }
}
