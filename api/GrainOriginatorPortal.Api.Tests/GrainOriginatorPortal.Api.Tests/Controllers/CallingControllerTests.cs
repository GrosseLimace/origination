// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The client reads 204 from the token endpoint as "this environment has no calling", which is the
/// state every environment is in until IT provisions it. That status mapping is the contract the
/// Angular service is built on, so it is pinned here.
/// </summary>
public class CallingControllerTests
{
    private readonly Mock<ICallingTokenService> _tokens = new();
    private readonly Mock<ICallingMatchService> _matches = new();

    private CallingController Build() => new(_tokens.Object, _matches.Object);

    [Fact]
    public async Task GetToken_WhenUnavailable_Answers204()
    {
        _tokens.Setup(t => t.GetTokenForCallerAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((CallingTokenResponse?)null);

        var result = await Build().GetToken(CancellationToken.None);

        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task GetToken_WhenMinted_Answers200WithTheToken()
    {
        var token = new CallingTokenResponse { Token = "acs-token", ExpiresOn = DateTimeOffset.UtcNow.AddHours(1) };
        _tokens.Setup(t => t.GetTokenForCallerAsync(It.IsAny<CancellationToken>())).ReturnsAsync(token);

        var result = await Build().GetToken(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Same(token, ok.Value);
    }

    [Fact]
    public async Task Match_AlwaysAnswers200_EvenForAnUnknownCaller()
    {
        _matches.Setup(m => m.MatchAsync("+14025550000", It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var result = await Build().Match("+14025550000", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Empty(Assert.IsType<List<IncomingCallMatchResponse>>(ok.Value));
    }

    [Fact]
    public async Task Match_PassesTheRawNumberThrough()
    {
        // Normalisation is the service's job; the controller must not pre-digest the number.
        _matches.Setup(m => m.MatchAsync("(402) 555-4914", It.IsAny<CancellationToken>()))
            .ReturnsAsync([new IncomingCallMatchResponse { CustomerId = 1, Name = "Smith Farms" }]);

        var result = await Build().Match("(402) 555-4914", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(Assert.IsType<List<IncomingCallMatchResponse>>(ok.Value));
    }
}
