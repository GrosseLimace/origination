// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Identity.Web;

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
/// are load-bearing: it is only ever minted for the caller's own identity, and every way the
/// exchange can fail turns into "unavailable" (null) rather than an exception, because the popup
/// must simply stay dormant in environments where IT has not provisioned it yet.
/// </summary>
public class CallingTokenServiceTests
{
    private const string Endpoint = "https://acs-origination-dev.unitedstates.communication.azure.com";
    private const string ApiClientId = "00078a10-3f3f-4d17-9350-fe90401125ae";
    private const string CallerOid = "7ff98598-94a0-42cb-81d9-87a6200cb3d9";

    private readonly Mock<ITokenAcquisition> _tokens = new();
    private readonly Mock<IRequestContextService> _ctx = new();
    private readonly Mock<CommunicationIdentityClient> _acs = new();
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 100 });

    public CallingTokenServiceTests()
    {
        _ctx.Setup(c => c.GetCurrentUserObjectId()).Returns(CallerOid);
    }

    private CallingTokenService Build(string? endpoint = Endpoint, string? clientId = ApiClientId)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Acs:Endpoint"] = endpoint,
                ["AzureAd:ClientId"] = clientId,
            })
            .Build();

        var factory = new Mock<ICommunicationIdentityClientFactory>();
        factory.Setup(f => f.Create(It.IsAny<Uri>())).Returns(_acs.Object);

        return new CallingTokenService(_tokens.Object, _ctx.Object, factory.Object, _cache, config,
            new Mock<ILogger<CallingTokenService>>().Object);
    }

    private void ArrangeEntraToken(string token = "entra-token") =>
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .ReturnsAsync(token);

    private void ArrangeAcsToken(string token = "acs-token", TimeSpan? ttl = null) =>
        _acs.Setup(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(
                new AccessToken(token, DateTimeOffset.UtcNow + (ttl ?? TimeSpan.FromHours(1))),
                Mock.Of<Response>()));

    // ── The happy path ────────────────────────────────────────────────────────

    [Fact]
    public async Task MintsATokenForTheCallersOwnIdentity()
    {
        ArrangeEntraToken("entra-token");
        ArrangeAcsToken("acs-token");
        GetTokenForTeamsUserOptions? sent = null;
        _acs.Setup(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()))
            .Callback<GetTokenForTeamsUserOptions, CancellationToken>((o, _) => sent = o)
            .ReturnsAsync(Response.FromValue(
                new AccessToken("acs-token", DateTimeOffset.UtcNow.AddHours(1)), Mock.Of<Response>()));

        var result = await Build().GetTokenForCallerAsync(CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("acs-token", result.Token);
        Assert.True(result.ExpiresOn > DateTimeOffset.UtcNow);
        // The exchange is pinned to the caller: their Entra token, our API's client id, their oid.
        Assert.NotNull(sent);
        Assert.Equal("entra-token", sent.TeamsUserAadToken);
        Assert.Equal(ApiClientId, sent.ClientId);
        Assert.Equal(CallerOid, sent.UserObjectId);
    }

    [Fact]
    public async Task AsksEntraForTheAcsScope_NotAGraphScope()
    {
        IEnumerable<string>? requested = null;
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .Callback<IEnumerable<string>, string?, string?, System.Security.Claims.ClaimsPrincipal?, TokenAcquisitionOptions?>(
                (scopes, _, _, _, _) => requested = scopes)
            .ReturnsAsync("entra-token");
        ArrangeAcsToken();

        await Build().GetTokenForCallerAsync(CancellationToken.None);

        Assert.Equal(["https://auth.msft.communication.azure.com/Teams.ManageCalls"], requested);
    }

    [Fact]
    public async Task SecondCall_IsServedFromThePerUserCache()
    {
        ArrangeEntraToken();
        ArrangeAcsToken();
        var sut = Build();

        var first = await sut.GetTokenForCallerAsync(CancellationToken.None);
        var second = await sut.GetTokenForCallerAsync(CancellationToken.None);

        Assert.Same(first, second);
        _acs.Verify(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ATokenAboutToExpire_IsReturnedButNotCached()
    {
        // Less than the 5-minute margin left: hand it over (the SDK can still use it) but do not
        // pin it in the cache, or every call for the next few minutes would get a dying token.
        ArrangeEntraToken();
        ArrangeAcsToken(ttl: TimeSpan.FromMinutes(2));
        var sut = Build();

        Assert.NotNull(await sut.GetTokenForCallerAsync(CancellationToken.None));
        Assert.NotNull(await sut.GetTokenForCallerAsync(CancellationToken.None));

        _acs.Verify(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    // ── Everything that can go wrong degrades to null ─────────────────────────

    [Fact]
    public async Task NoEndpointConfigured_ReturnsNull_WithoutAnyExchange()
    {
        // Local and any environment where IT has not provisioned the ACS resource yet.
        var result = await Build(endpoint: "").GetTokenForCallerAsync(CancellationToken.None);

        Assert.Null(result);
        _tokens.Verify(t => t.GetAccessTokenForUserAsync(
            It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
            It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()), Times.Never);
    }

    [Fact]
    public async Task ConsentNotGranted_ReturnsNull_RatherThanThrowing()
    {
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .ThrowsAsync(new MicrosoftIdentityWebChallengeUserException(
                new Microsoft.Identity.Client.MsalUiRequiredException("consent_required", "consent required"),
                CallingTokenService.AcsScopes));

        Assert.Null(await Build().GetTokenForCallerAsync(CancellationToken.None));
    }

    [Fact]
    public async Task EntraExchangeFails_ReturnsNull()
    {
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .ThrowsAsync(new InvalidOperationException("no client credential"));

        Assert.Null(await Build().GetTokenForCallerAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AcsRejectsTheExchange_ReturnsNull()
    {
        // Wrong endpoint, the managed identity lacks the role, or the user has no Teams licence.
        ArrangeEntraToken();
        _acs.Setup(a => a.GetTokenForTeamsUserAsync(It.IsAny<GetTokenForTeamsUserOptions>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(401, "Unauthorized"));

        Assert.Null(await Build().GetTokenForCallerAsync(CancellationToken.None));
    }

    [Fact]
    public async Task CallerWithoutObjectId_ReturnsNull_WithoutAnyExchange()
    {
        // ACS binds the token to the oid; without one there is nobody to mint it for.
        _ctx.Setup(c => c.GetCurrentUserObjectId()).Returns((string?)null);

        Assert.Null(await Build().GetTokenForCallerAsync(CancellationToken.None));
        _tokens.Verify(t => t.GetAccessTokenForUserAsync(
            It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
            It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()), Times.Never);
    }

    [Fact]
    public async Task MissingClientId_ReturnsNull()
    {
        ArrangeEntraToken();

        Assert.Null(await Build(clientId: "").GetTokenForCallerAsync(CancellationToken.None));
    }
}
