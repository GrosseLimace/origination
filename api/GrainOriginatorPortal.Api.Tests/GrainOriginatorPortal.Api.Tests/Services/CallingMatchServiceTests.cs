// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The match service sits between a raw caller id and the repository. Two things matter: a caller
/// id that cannot be a phone number never reaches the database, and what comes back carries the
/// fields the popup renders (name, customer code, first trade unit).
/// </summary>
public class CallingMatchServiceTests
{
    private readonly Mock<ICustomerRepository> _customers = new();

    private CallingMatchService Build() =>
        new(_customers.Object, new Mock<ILogger<CallingMatchService>>().Object);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("anonymous")]
    [InlineData("12345")]
    public async Task UnusableCallerId_ReturnsEmpty_WithoutTouchingTheRepository(string? number)
    {
        var matches = await Build().MatchAsync(number, CancellationToken.None);

        Assert.Empty(matches);
        _customers.Verify(c => c.FindByPhoneAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task E164CallerId_IsLookedUpAsTenDigits()
    {
        // The SDK reports "+14025554914"; stored numbers never carry the country code.
        _customers.Setup(c => c.FindByPhoneAsync("4025554914", It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        await Build().MatchAsync("+14025554914", CancellationToken.None);

        _customers.Verify(c => c.FindByPhoneAsync("4025554914", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MapsTheFieldsThePopupRenders()
    {
        _customers.Setup(c => c.FindByPhoneAsync("4025554914", It.IsAny<CancellationToken>()))
            .ReturnsAsync(
            [
                new CustomerPhoneMatch
                {
                    Customer = new Customer
                    {
                        Id = 158259,
                        Name = "A & B ORGANIC ACRES",
                        ScoularId = "MWACRST",
                        Location = "Minden",
                        StateProvince = "NE",
                        ActiveTradeUnits = ["3811", "3812"],
                    },
                },
                new CustomerPhoneMatch { Customer = new Customer { Id = 2, Name = "No Trade Units Yet" } },
            ]);

        var matches = await Build().MatchAsync("(402) 555-4914", CancellationToken.None);

        Assert.Equal(2, matches.Count);
        var first = matches[0];
        Assert.Equal(158259, first.CustomerId);
        Assert.Equal("A & B ORGANIC ACRES", first.Name);
        Assert.Equal("MWACRST", first.ScoularId);
        Assert.Equal("Minden", first.Location);
        Assert.Equal("NE", first.StateProvince);
        Assert.Equal("3811", first.TradeUnit);               // first active TU, for the card
        Assert.Equal(["3811", "3812"], first.TradeUnits);
        Assert.Null(matches[1].TradeUnit);                   // no membership rows → no TU, not a crash
        Assert.Empty(matches[1].TradeUnits);
        Assert.Null(first.ContactName);                      // matched the producer's own phone
    }

    [Fact]
    public async Task NumberOnAnAddedContact_CarriesTheNameTheOriginatorEntered()
    {
        // Originators add people (Dad, the farm manager) with their own numbers on the producer
        // details card. A call from one of them should say who it is, not just which producer.
        _customers.Setup(c => c.FindByPhoneAsync("4025554914", It.IsAny<CancellationToken>()))
            .ReturnsAsync(
            [
                new CustomerPhoneMatch
                {
                    Customer = new Customer { Id = 158259, Name = "Smith Farms", ScoularId = "SMIFAR" },
                    ContactNames = ["Jane Smith", "Smith Farms Office"],
                },
            ]);

        var match = Assert.Single(await Build().MatchAsync("+14025554914", CancellationToken.None));

        Assert.Equal("Jane Smith", match.ContactName);       // primary / first contact with the number
        Assert.Equal(["Jane Smith", "Smith Farms Office"], match.ContactNames);
        Assert.Equal("Smith Farms", match.Name);             // still tells you whose contact it is
    }
}
