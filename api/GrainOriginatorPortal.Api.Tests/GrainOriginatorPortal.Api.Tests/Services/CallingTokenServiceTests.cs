// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Azure;
using Azure.Communication.Identity;
using Azure.Core;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The calling token is what lets a browser tab ring with a user's Teams calls, so two properties
/// are load-bearing: the exchange is bound to the CALLER (object id from their own API token, client
/// id = the SPA that acquired the Entra token), and every way it can fail becomes an outcome rather
/// than an exception, because the popup must stay dormant where IT has not provisioned calling.
/// </summary>
public class CallingTokenServiceTests
{
    private const string Endpoint = "https://acs-origination-dev-eus.unitedstates.communication.azure.com";
    private const string SpaClientId = "e0f25943-ae8b-4c2d-8060-c9ffbd448aff";
    private const string CallerOid = "7ff98598-94a0-42cb-81d9-87a6200cb3d9";
    private const string EntraToken = "entra-token-for-acs-scopes";

    private readonly Mock<IRequestContextService> _ctx = new();
    private readonly Mock<CommunicationIdentityClient> _acs = new();

    public CallingTokenServiceTests()
    {
        _ctx.Setup(c => c.GetCurrentUserObjectId()).Returns(CallerOid);
    }

    private CallingTokenService Build(string? endpoint = Endpoint, string? teamsClientId = SpaClientId)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Acs:Endpoint"] = endpoint,
                ["Acs:TeamsClientId"] = teamsClientId,
            })
            .Build();

        var factory = new Mock<ICommunicationIdentityClientFactory>();
        factory.Setup(f => f.Create(It.IsAny<Uri>())).Returns(_acs.Object);

        return new CallingTokenService(_ctx.Object, factory.Object, config,
            new Mock<ILogger<CallingTokenService>>().Object);
    }

    private void ArrangeAcsToken(string token = "acs-token") =>
        _acs.Setup(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(
                new AccessToken(token, DateTimeOffset.UtcNow.AddHours(1)), Mock.Of<Response>()));

    // ── The happy path ────────────────────────────────────────────────────────

    [Fact]
    public async Task ExchangesForTheCaller_WithTheSpaClientId()
    {
        GetTokenForTeamsUserOptions? sent = null;
        _acs.Setup(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()))
            .Callback<GetTokenForTeamsUserOptions, CancellationToken>((o, _) => sent = o)
            .ReturnsAsync(Response.FromValue(
                new AccessToken("acs-token", DateTimeOffset.UtcNow.AddHours(1)), Mock.Of<Response>()));

        var result = await Build().ExchangeAsync(EntraToken, CancellationToken.None);

        Assert.Equal(CallingTokenOutcome.Issued, result.Outcome);
        Assert.Equal("acs-token", result.Token!.Token);
        Assert.True(result.Token.ExpiresOn > DateTimeOffset.UtcNow);
        // Pinned to the caller: their Entra token, the SPA's client id (the token's appid), their oid.
        Assert.NotNull(sent);
        Assert.Equal(EntraToken, sent.TeamsUserAadToken);
        Assert.Equal(SpaClientId, sent.ClientId);
        Assert.Equal(CallerOid, sent.UserObjectId);
    }

    [Fact]
    public async Task UsesTheConfiguredEndpoint()
    {
        Uri? used = null;
        var factory = new Mock<ICommunicationIdentityClientFactory>();
        factory.Setup(f => f.Create(It.IsAny<Uri>())).Callback<Uri>(u => used = u).Returns(_acs.Object);
        ArrangeAcsToken();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Acs:Endpoint"] = Endpoint, ["Acs:TeamsClientId"] = SpaClientId,
        }).Build();
        var sut = new CallingTokenService(_ctx.Object, factory.Object, config, new Mock<ILogger<CallingTokenService>>().Object);

        await sut.ExchangeAsync(EntraToken, CancellationToken.None);

        Assert.Equal(new Uri(Endpoint), used);
    }

    [Fact]
    public async Task DoesNotCacheTokens_EveryCallExchangesAgain()
    {
        // Infrastructure's rule: no server-side token cache; the SDK refreshes on demand.
        ArrangeAcsToken();
        var sut = Build();

        await sut.ExchangeAsync(EntraToken, CancellationToken.None);
        await sut.ExchangeAsync(EntraToken, CancellationToken.None);

        _acs.Verify(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    // ── Everything that can go wrong becomes an outcome ───────────────────────

    [Theory]
    [InlineData("", SpaClientId)]
    [InlineData(null, SpaClientId)]
    [InlineData(Endpoint, "")]
    public async Task NotConfigured_IsUnavailable_WithoutTouchingAcs(string? endpoint, string? clientId)
    {
        // Local and any environment where IT has not provisioned the ACS resource or consent.
        var result = await Build(endpoint, clientId).ExchangeAsync(EntraToken, CancellationToken.None);

        Assert.Equal(CallingTokenOutcome.Unavailable, result.Outcome);
        _acs.Verify(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task MissingEntraToken_IsInvalidRequest(string? token)
    {
        var result = await Build().ExchangeAsync(token, CancellationToken.None);

        Assert.Equal(CallingTokenOutcome.InvalidRequest, result.Outcome);
        _acs.Verify(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CallerWithoutObjectId_IsInvalidRequest()
    {
        // ACS binds the token to the oid; without one there is nobody to mint it for — and the oid
        // must come from the validated API token, never from the body.
        _ctx.Setup(c => c.GetCurrentUserObjectId()).Returns((string?)null);

        var result = await Build().ExchangeAsync(EntraToken, CancellationToken.None);

        Assert.Equal(CallingTokenOutcome.InvalidRequest, result.Outcome);
    }

    [Fact]
    public async Task AcsRejects_IsExchangeFailed_WithTheStatus()
    {
        // Wrong client id, token for another user, missing role, or no Teams licence.
        _acs.Setup(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(401, "Unauthorized"));

        var result = await Build().ExchangeAsync(EntraToken, CancellationToken.None);

        Assert.Equal(CallingTokenOutcome.ExchangeFailed, result.Outcome);
        Assert.Equal(401, result.AcsStatus);
        Assert.Null(result.Token);
    }

    [Fact]
    public async Task AcsUnreachable_IsExchangeFailed()
    {
        _acs.Setup(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("connection refused"));

        var result = await Build().ExchangeAsync(EntraToken, CancellationToken.None);

        Assert.Equal(CallingTokenOutcome.ExchangeFailed, result.Outcome);
        Assert.Null(result.AcsStatus);
    }
}
