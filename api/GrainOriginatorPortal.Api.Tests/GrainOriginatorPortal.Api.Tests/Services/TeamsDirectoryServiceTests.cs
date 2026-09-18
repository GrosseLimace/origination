// System namespaces
using System.Net;
using System.Text;

// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Identity.Web;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The channel lookup moved out of the browser and into the API on 2026-09-15, so the fail-soft
/// behaviour the picker relies on now lives here. The rule throughout: this source may be dark for
/// any reason at all, and the "@" menu must still offer people and trade units, so nothing in here
/// is allowed to throw.
/// </summary>
public class TeamsDirectoryServiceTests
{
    private const string Caller = "CEgr@scoular.com";

    private readonly StubHandler _handler = new();
    private readonly Mock<ITokenAcquisition> _tokens = new();
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 100 });

    private TeamsDirectoryService Build(string callerUpn = Caller)
    {
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("graph"))
            .Returns(() => new HttpClient(_handler) { BaseAddress = new Uri("https://graph.microsoft.com/v1.0/") });

        var ctx = new Mock<IRequestContextService>();
        ctx.Setup(c => c.GetCurrentUser()).Returns(callerUpn);

        return new TeamsDirectoryService(_tokens.Object, factory.Object, ctx.Object, _cache,
            new Mock<ILogger<TeamsDirectoryService>>().Object);
    }

    private void ArrangeToken(string token = "graph-token") =>
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .ReturnsAsync(token);

    private const string OneTeam = """{"value":[{"id":"t1","displayName":"Trading"}]}""";

    // ── The happy path ────────────────────────────────────────────────────────

    [Fact]
    public async Task ReturnsTheCallersChannels()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, OneTeam);
        _handler.Enqueue(HttpStatusCode.OK, """
            {"value":[{"id":"c1","displayName":"Grain Desk","email":"abcd.scoular.com@amer.teams.ms"}]}
            """);

        var channels = await Build().GetMyChannelsAsync(CancellationToken.None);

        var only = Assert.Single(channels);
        Assert.Equal("Grain Desk", only.DisplayName);
        Assert.Equal("Trading", only.TeamName);       // team name carried through for the picker label
        Assert.Equal("t1", only.TeamId);
        Assert.Equal("abcd.scoular.com@amer.teams.ms", only.ChannelEmail);
    }

    [Fact]
    public async Task AsksGraphForTheEmailFieldExplicitly()
    {
        // Graph omits `email` unless $select names it, because populating it is expensive. Without
        // this every channel would look like it has no address and the picker would be empty.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, OneTeam);
        _handler.Enqueue(HttpStatusCode.OK, """{"value":[]}""");

        await Build().GetMyChannelsAsync(CancellationToken.None);

        Assert.Contains(_handler.RequestUris, u => u.Contains("email"));
    }

    [Fact]
    public async Task DropsChannelsThatHaveNoEmailAddress()
    {
        // Teams does not create an address until somebody picks "Get email address", and we hold no
        // permission to provision one, so such a channel cannot be posted to and must not be offered.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, OneTeam);
        _handler.Enqueue(HttpStatusCode.OK, """
            {"value":[{"id":"c1","displayName":"No Address"},
                      {"id":"c2","displayName":"Usable","email":"abcd.scoular.com@amer.teams.ms"}]}
            """);

        var channels = await Build().GetMyChannelsAsync(CancellationToken.None);

        Assert.Equal("Usable", Assert.Single(channels).DisplayName);
    }

    // ── Everything that can go wrong degrades to empty ────────────────────────

    [Fact]
    public async Task ConsentNotGranted_ReturnsEmpty_RatherThanThrowing()
    {
        // The expected state in QA and Production until IT grants consent. A throw here would break
        // the whole mention picker, not just the channel section.
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .ThrowsAsync(new MicrosoftIdentityWebChallengeUserException(
                new Microsoft.Identity.Client.MsalUiRequiredException("consent_required", "consent required"), ["Team.ReadBasic.All"]));

        Assert.Empty(await Build().GetMyChannelsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task MissingGraphPermission_ReturnsEmpty()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Forbidden, "{}");

        Assert.Empty(await Build().GetMyChannelsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task GraphUnreachable_ReturnsEmpty()
    {
        ArrangeToken();
        _handler.ThrowOnSend = new HttpRequestException("network down");

        Assert.Empty(await Build().GetMyChannelsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task OneInaccessibleTeam_DoesNotLoseTheOthers()
    {
        // A user can belong to a team whose channels they cannot list. That must cost one team, not
        // the whole result.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, """
            {"value":[{"id":"t1","displayName":"Trading"},{"id":"t2","displayName":"Locked"}]}
            """);
        _handler.Enqueue(HttpStatusCode.OK, """
            {"value":[{"id":"c1","displayName":"Grain Desk","email":"abcd.scoular.com@amer.teams.ms"}]}
            """);
        _handler.Enqueue(HttpStatusCode.Forbidden, "{}");

        var channels = await Build().GetMyChannelsAsync(CancellationToken.None);

        Assert.Equal("Grain Desk", Assert.Single(channels).DisplayName);
    }

    // ── Caching ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task CachesPerUser_SoOneCallersTeamsNeverServeAnother()
    {
        // The result is that person's team membership. A shared cache entry would be a disclosure.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, OneTeam);
        _handler.Enqueue(HttpStatusCode.OK, """
            {"value":[{"id":"c1","displayName":"Grain Desk","email":"abcd.scoular.com@amer.teams.ms"}]}
            """);
        _handler.Enqueue(HttpStatusCode.OK, """{"value":[]}""");   // second caller: no teams

        var first = await Build("CEgr@scoular.com").GetMyChannelsAsync(CancellationToken.None);
        var second = await Build("SFletcher@scoular.com").GetMyChannelsAsync(CancellationToken.None);

        Assert.Single(first);
        Assert.Empty(second);
    }

    [Fact]
    public async Task RepeatCallForTheSameUser_DoesNotHitGraphAgain()
    {
        // Listing channels costs one request PER TEAM, so re-running it on every note pane would be
        // the expensive mistake this cache exists to prevent.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, OneTeam);
        _handler.Enqueue(HttpStatusCode.OK, """
            {"value":[{"id":"c1","displayName":"Grain Desk","email":"abcd.scoular.com@amer.teams.ms"}]}
            """);
        var sut = Build();

        await sut.GetMyChannelsAsync(CancellationToken.None);
        var callsAfterFirst = _handler.RequestUris.Count;
        await sut.GetMyChannelsAsync(CancellationToken.None);

        Assert.Equal(callsAfterFirst, _handler.RequestUris.Count);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new();
        public List<string> RequestUris { get; } = [];
        public Exception? ThrowOnSend { get; set; }

        public void Enqueue(HttpStatusCode status, string json) =>
            _responses.Enqueue(new HttpResponseMessage(status)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUris.Add(request.RequestUri!.ToString());
            if (ThrowOnSend is not null) throw ThrowOnSend;
            // Per-team requests run in parallel, so guard the queue.
            lock (_responses)
            {
                if (_responses.Count == 0)
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new StringContent("""{"value":[]}""", Encoding.UTF8, "application/json"),
                    });
                return Task.FromResult(_responses.Dequeue());
            }
        }
    }
}
