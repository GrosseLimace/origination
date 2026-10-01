// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

// Project namespaces
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// The middleware only records; these pin WHAT it records, since the switches trust it for both the
/// identity matched against the allow-list and the preference it honours.
/// </summary>
public class CtrmSourceChoiceMiddlewareTests
{
    private static async Task<CtrmSourceChoice> Run(ClaimsPrincipal? user, string? header)
    {
        var choice = new CtrmSourceChoice();
        var context = new DefaultHttpContext();
        if (user is not null) context.User = user;
        if (header is not null) context.Request.Headers[CtrmSourceChoice.PreferenceHeader] = header;

        var nextCalled = false;
        var sut = new CtrmSourceChoiceMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });
        await sut.InvokeAsync(context, choice);

        Assert.True(nextCalled);
        return choice;
    }

    private static ClaimsPrincipal Principal(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value)), "test"));

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RecordsThePreferredUsernameAndTheHeader()
    {
        var choice = await Run(Principal(("preferred_username", "CEgr@scoular.com")), "ctrm");

        Assert.Equal("CEgr@scoular.com", choice.UserId);
        Assert.Equal("ctrm", choice.RequestedSource);
    }

    [Fact]
    public async Task UsesTheSameClaimOrderAsTheRequestContext_SoTheIdMatchesTheLogsAndMe()
    {
        // No preferred_username: falls to upn, then oid - the order RequestContextService uses.
        var byUpn = await Run(Principal((ClaimTypes.Upn, "CEgr@scoular.com"), ("oid", "guid")), null);
        Assert.Equal("CEgr@scoular.com", byUpn.UserId);

        var byOid = await Run(Principal(("oid", "7d1a-guid")), null);
        Assert.Equal("7d1a-guid", byOid.UserId);
    }

    [Fact]
    public async Task AnAnonymousRequest_RecordsNoUser()
    {
        var choice = await Run(null, "ctrm");

        Assert.Null(choice.UserId);
        // ...and therefore can never be routed by the header, whatever it says.
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = "ods", ["Ctrm:SourceToggleUsers"] = "CEgr@scoular.com",
        }).Build();
        Assert.False(choice.UsesCtrm(config));
    }

    [Fact]
    public async Task NoHeader_RecordsNoPreference()
    {
        var choice = await Run(Principal(("preferred_username", "CEgr@scoular.com")), null);
        Assert.Null(choice.RequestedSource);
    }

    [Fact]
    public async Task TheHeaderIsCappedAndCleaned_BeforeItIsStored()
    {
        // The value is request-supplied text; it is stored only for Normalise(), which accepts two
        // spellings, but it is still cleaned so it can be logged or echoed safely.
        var choice = await Run(Principal(("preferred_username", "CEgr@scoular.com")), "ctrm\r\nX-Injected: yes" + new string('a', 100));

        Assert.NotNull(choice.RequestedSource);
        Assert.DoesNotContain('\n', choice.RequestedSource);
        Assert.True(choice.RequestedSource!.Length <= 16);
        Assert.Null(CtrmSourceChoice.Normalise(choice.RequestedSource));
    }
}
