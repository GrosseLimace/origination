// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The status codes are the contract the Angular service is built on: 204 means "this environment
/// has no calling" (the state every environment is in until IT provisions it) and the client never
/// loads the SDK; 502 means the exchange failed and the client stays dormant too, but the server
/// logged why.
/// </summary>
public class CallingControllerTests
{
    private readonly Mock<ICallingTokenService> _tokens = new();
    private readonly Mock<ICallingMatchService> _matches = new();

    private CallingController Build()
    {
        var ctx = new Mock<IRequestContextService>();
        ctx.Setup(c => c.GetTraceId()).Returns("trace-1");
        return new CallingController(_tokens.Object, _matches.Object, ctx.Object);
    }

    private void ArrangeOutcome(CallingTokenResult result) =>
        _tokens.Setup(t => t.ExchangeAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);

    private static ExchangeCallingTokenRequest Body(string? token = "entra-token") => new() { TeamsUserAadToken = token };

    [Fact]
    public async Task Token_WhenCallingIsNotConfigured_Answers204()
    {
        ArrangeOutcome(new CallingTokenResult(CallingTokenOutcome.Unavailable));

        var result = await Build().ExchangeToken(Body(), CancellationToken.None);

        Assert.IsType<NoContentResult>(result.Result);
    }

    [Fact]
    public async Task Token_WhenIssued_Answers200WithTheToken()
    {
        var token = new CallingTokenResponse { Token = "acs-token", ExpiresOn = DateTimeOffset.UtcNow.AddHours(1) };
        ArrangeOutcome(new CallingTokenResult(CallingTokenOutcome.Issued, token));

        var result = await Build().ExchangeToken(Body(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Same(token, ok.Value);
    }

    [Fact]
    public async Task Token_PassesTheBodyTokenToTheService()
    {
        ArrangeOutcome(new CallingTokenResult(CallingTokenOutcome.Unavailable));

        await Build().ExchangeToken(Body("the-entra-token"), CancellationToken.None);

        _tokens.Verify(t => t.ExchangeAsync("the-entra-token", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Token_WhenTheRequestIsInvalid_Answers400WithTheErrorEnvelope()
    {
        ArrangeOutcome(new CallingTokenResult(CallingTokenOutcome.InvalidRequest));

        var result = await Build().ExchangeToken(Body(null), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiErrorResponse>(bad.Value);
        Assert.Equal("VALIDATION_ERROR", body.Error.Code);
        Assert.Equal("trace-1", body.Error.TraceId);
    }

    [Fact]
    public async Task Token_WhenAcsRefuses_Answers502WithTheErrorEnvelope()
    {
        ArrangeOutcome(new CallingTokenResult(CallingTokenOutcome.ExchangeFailed, AcsStatus: 401));

        var result = await Build().ExchangeToken(Body(), CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status502BadGateway, status.StatusCode);
        var body = Assert.IsType<ApiErrorResponse>(status.Value);
        Assert.Equal("CALLING_TOKEN_EXCHANGE_FAILED", body.Error.Code);
        // The response never carries the tokens or ACS's own message.
        Assert.DoesNotContain("entra", body.Error.Message, StringComparison.OrdinalIgnoreCase);
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
