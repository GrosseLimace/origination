// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// The middleware records identity, header and list membership; the switches trust it for all three.
/// </summary>
public class CtrmSourceChoiceMiddlewareTests
{
    private static IConfiguration Config(string toggleUsers = "") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = "ods", ["Ctrm:SourceToggleUsers"] = toggleUsers,
        }).Build();

    private static async Task<(CtrmSourceChoice Choice, Mock<ICtrmSourceToggleUserProvider> Provider)> Run(
        ClaimsPrincipal? user, string? header, IConfiguration? config = null, params string[] tableUsers)
    {
        var choice = new CtrmSourceChoice();
        var context = new DefaultHttpContext();
        if (user is not null) context.User = user;
        if (header is not null) context.Request.Headers[CtrmSourceChoice.PreferenceHeader] = header;

        var provider = new Mock<ICtrmSourceToggleUserProvider>();
        provider.Setup(p => p.GetAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string>(tableUsers, StringComparer.OrdinalIgnoreCase));

        var nextCalled = false;
        var sut = new CtrmSourceChoiceMiddleware(_ => { nextCalled = true; return Task.CompletedTask; }, config ?? Config());
        await sut.InvokeAsync(context, choice, provider.Object);

        Assert.True(nextCalled);
        return (choice, provider);
    }

    private static ClaimsPrincipal Principal(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value)), "test"));

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RecordsThePreferredUsernameAndTheHeader()
    {
        var (choice, _) = await Run(Principal(("preferred_username", "CEgr@scoular.com")), "ctrm");

        Assert.Equal("CEgr@scoular.com", choice.UserId);
        Assert.Equal("ctrm", choice.RequestedSource);
    }

    [Fact]
    public async Task UsesTheSameClaimOrderAsTheRequestContext_SoTheIdMatchesTheLogsAndMe()
    {
        // No preferred_username: falls to upn, then oid - the order RequestContextService uses.
        var (byUpn, _) = await Run(Principal((ClaimTypes.Upn, "CEgr@scoular.com"), ("oid", "guid")), null);
        Assert.Equal("CEgr@scoular.com", byUpn.UserId);

        var (byOid, _) = await Run(Principal(("oid", "7d1a-guid")), null);
        Assert.Equal("7d1a-guid", byOid.UserId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ATableTester_IsAllowListed()
    {
        var (choice, _) = await Run(Principal(("preferred_username", "CEgr@scoular.com")), "ctrm", tableUsers: "cegr@scoular.com");

        Assert.True(choice.CanChoose);
        Assert.True(choice.UsesCtrm(Config()));
    }

    [Fact]
    public async Task AConfigTester_IsAllowListed_EvenWithAnEmptyTable()
    {
        var (choice, _) = await Run(Principal(("preferred_username", "CEgr@scoular.com")), "ctrm", Config(toggleUsers: "CEgr@scoular.com"));

        Assert.True(choice.CanChoose);
    }

    [Fact]
    public async Task AnyoneElse_IsNot()
    {
        var (choice, _) = await Run(Principal(("preferred_username", "someone@scoular.com")), "ctrm", Config(toggleUsers: "CEgr@scoular.com"), "other@scoular.com");

        Assert.False(choice.CanChoose);
        Assert.False(choice.UsesCtrm(Config()));
    }

    [Fact]
    public async Task AnAnonymousRequest_RecordsNoUser_AndDoesNotConsultTheTable()
    {
        var (choice, provider) = await Run(null, "ctrm", tableUsers: "CEgr@scoular.com");

        Assert.Null(choice.UserId);
        Assert.False(choice.CanChoose);
        provider.Verify(p => p.GetAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task NoHeader_RecordsNoPreference()
    {
        var (choice, _) = await Run(Principal(("preferred_username", "CEgr@scoular.com")), null);
        Assert.Null(choice.RequestedSource);
    }

    [Fact]
    public async Task TheHeaderIsCappedAndCleaned_BeforeItIsStored()
    {
        // The value is request-supplied text; it is stored only for Normalise(), which accepts two
        // spellings, but it is still cleaned so it can be logged or echoed safely.
        var (choice, _) = await Run(Principal(("preferred_username", "CEgr@scoular.com")), "ctrm\r\nX-Injected: yes" + new string('a', 100));

        Assert.NotNull(choice.RequestedSource);
        Assert.DoesNotContain('\n', choice.RequestedSource);
        Assert.True(choice.RequestedSource!.Length <= 16);
        Assert.Null(CtrmSourceChoice.Normalise(choice.RequestedSource));
    }
}
