// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the open-activity trade-unit rule that locks memberships in the edit dialog and drives the
/// nightly sync's bring-back.
/// </summary>
/// <remarks>
/// This used to query the ODS views directly. It now reads through the switch-backed contract and
/// ticket repositories, so whichever source the producer screen is on, this agrees with it. These tests
/// pin the rule itself - open contracts lock their trade unit, unapplied tickets lock their organization,
/// closed contracts and blank codes do not - independent of which source answers.
/// </remarks>
public class CustomerRepositoryOpenActivityTests
{
    private const string Producer = "TESTPRD";

    private static (CustomerRepository Sut, Mock<IContractRepository> Contracts, Mock<ITicketRepository> Tickets) Build()
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"openact-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"openact-app-{Guid.NewGuid()}").Options);

        var contracts = new Mock<IContractRepository>(MockBehavior.Strict);
        var tickets = new Mock<ITicketRepository>(MockBehavior.Strict);

        var sut = new CustomerRepository(ods, app, tickets.Object, contracts.Object,
            new Mock<ILogger<CustomerRepository>>().Object);

        return (sut, contracts, tickets);
    }

    private static Contract OpenContract(string tradeUnit) => new()
    {
        SourceContractId = $"P{Guid.NewGuid():N}"[..9], ContractNumber = "X", TradeUnit = tradeUnit, ClosedDate = null
    };

    private static Contract ClosedContract(string tradeUnit) => new()
    {
        SourceContractId = $"P{Guid.NewGuid():N}"[..9], ContractNumber = "X", TradeUnit = tradeUnit,
        ClosedDate = new DateTime(2026, 1, 15)
    };

    private static Ticket Unapplied(string organizationCode) => new()
    {
        TicketNumber = "1", CtrmContractNumber = "UWW000001", OrganizationCode = organizationCode, CustomerCode = Producer
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task OpenContractsAndUnappliedTicketsBothLockTheirTradeUnit()
    {
        var (sut, contracts, tickets) = Build();
        contracts.Setup(r => r.GetByCustomerAsync(It.IsAny<long>(), Producer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([OpenContract("4056"), OpenContract(" 4056 ")]);
        tickets.Setup(r => r.GetUnappliedByCustomerAsync(It.IsAny<long>(), Producer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([Unapplied("2190")]);

        var open = await sut.GetOpenActivityTradeUnitsAsync(Producer, CancellationToken.None);

        // Trimmed and de-duplicated: the membership table stores clean codes and the comparison is exact.
        Assert.Equal(new[] { "2190", "4056" }, open.OrderBy(x => x));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AClosedContractDoesNotLockItsTradeUnit()
    {
        // The repositories return open-OR-recent contracts, so a recently closed one arrives here and must
        // be excluded - a closed contract is exactly the case where the user should be free to remove the
        // membership.
        var (sut, contracts, tickets) = Build();
        contracts.Setup(r => r.GetByCustomerAsync(It.IsAny<long>(), Producer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([ClosedContract("4056")]);
        tickets.Setup(r => r.GetUnappliedByCustomerAsync(It.IsAny<long>(), Producer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var open = await sut.GetOpenActivityTradeUnitsAsync(Producer, CancellationToken.None);

        Assert.Empty(open);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ABlankCodeAsksNeitherRepository()
    {
        // Strict mocks: any call here fails the test. A blank code must short-circuit rather than fan out
        // to two reads that could only ever return nothing.
        var (sut, _, _) = Build();

        Assert.Empty(await sut.GetOpenActivityTradeUnitsAsync("  ", CancellationToken.None));
        Assert.Empty(await sut.GetOpenActivityTradeUnitsAsync(null!, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheUnappliedReadIsTheOneAlreadyStorageGated()
    {
        // The storage gate is applied INSIDE GetUnappliedByCustomerAsync on both sources. Pinning that this
        // method calls that read - and not the raw all-tickets read - is what keeps a priced-out storage
        // ticket from locking a trade unit here while the screen shows no such ticket.
        var (sut, contracts, tickets) = Build();
        contracts.Setup(r => r.GetByCustomerAsync(It.IsAny<long>(), Producer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        tickets.Setup(r => r.GetUnappliedByCustomerAsync(It.IsAny<long>(), Producer, It.IsAny<CancellationToken>()))
            .ReturnsAsync([Unapplied("3000")]);

        var open = await sut.GetOpenActivityTradeUnitsAsync(Producer, CancellationToken.None);

        Assert.Equal(["3000"], open);
        tickets.Verify(r => r.GetByCustomerAsync(It.IsAny<long>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
