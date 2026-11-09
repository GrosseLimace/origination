using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Xunit;
using GrainOriginatorPortal.Api.Platform.Identity;
using GrainOriginatorPortal.Api.Platform.Middleware;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class RequestContextServiceTests
{
    private static RequestContextService For(params Claim[] claims) =>
        new(new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } });

    [Fact]
    public void GetCurrentUserDisplayName_IsTheNameClaim()
    {
        var context = For(new Claim("preferred_username", "tess.tester@example.test"), new Claim("name", " Tess Tester "));

        Assert.Equal("Tess Tester", context.GetCurrentUserDisplayName());
        Assert.Equal("tess.tester@example.test", context.GetCurrentUser());
    }

    [Fact]
    public void GetCurrentUserDisplayName_WithoutANameClaim_IsTheUser()
    {
        Assert.Equal("tess.tester@example.test", For(new Claim("preferred_username", "tess.tester@example.test")).GetCurrentUserDisplayName());
    }
}
