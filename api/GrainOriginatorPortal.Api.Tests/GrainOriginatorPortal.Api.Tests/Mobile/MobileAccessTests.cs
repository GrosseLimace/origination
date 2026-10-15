// System namespaces
using System.Security.Claims;

// Project namespaces
using GrainOriginatorPortal.Mobile;
using GrainOriginatorPortal.Mobile.Authorization;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

public class MobileAccessTests
{
    private static readonly MobileOptions Configured = new()
    {
        RequiredScopes = ["Origination.Mobile.Dev"],
        AllowedClientAppIds = ["11111111-1111-1111-1111-111111111111"],
    };

    private static ClaimsPrincipal Principal(string? scp = null, string? azp = null, bool authenticated = true)
    {
        var claims = new List<Claim>();
        if (scp is not null) claims.Add(new Claim("scp", scp));
        if (azp is not null) claims.Add(new Claim("azp", azp));
        claims.Add(new Claim("oid", "user-oid"));
        var identity = authenticated ? new ClaimsIdentity(claims, "Bearer") : new ClaimsIdentity(claims);
        return new ClaimsPrincipal(identity);
    }

    [Fact]
    public void MobileToken_FromMobileClient_CanAccessMobile_NotDesktop()
    {
        var user = Principal(scp: "Origination.Mobile.Dev", azp: "11111111-1111-1111-1111-111111111111");

        Assert.True(MobileAccess.CanAccessMobileSurface(user, Configured));
        Assert.False(MobileAccess.CanAccessDesktopSurface(user, Configured));
    }

    [Fact]
    public void DesktopToken_CanAccessDesktop_NotMobile()
    {
        var user = Principal(scp: "Origination.Application.Dev", azp: "22222222-2222-2222-2222-222222222222");

        Assert.False(MobileAccess.CanAccessMobileSurface(user, Configured));
        Assert.True(MobileAccess.CanAccessDesktopSurface(user, Configured));
    }

    [Fact]
    public void MobileScope_FromUnknownClient_IsRejectedOnMobile_AndOnDesktop()
    {
        // Right scope, wrong client: neither surface. A leaked scope grant is not enough.
        var user = Principal(scp: "Origination.Mobile.Dev", azp: "99999999-9999-9999-9999-999999999999");

        Assert.False(MobileAccess.CanAccessMobileSurface(user, Configured));
        Assert.False(MobileAccess.CanAccessDesktopSurface(user, Configured));
    }

    [Fact]
    public void MobileClient_WithoutScope_IsKeptOffDesktop()
    {
        var user = Principal(scp: "Origination.Application.Dev", azp: "11111111-1111-1111-1111-111111111111");

        Assert.False(MobileAccess.CanAccessMobileSurface(user, Configured));
        Assert.False(MobileAccess.CanAccessDesktopSurface(user, Configured));
    }

    [Fact]
    public void EmptyRequiredScopes_FailsClosed()
    {
        var options = new MobileOptions { RequiredScopes = [], AllowedClientAppIds = ["11111111-1111-1111-1111-111111111111"] };
        var user = Principal(scp: "Origination.Mobile.Dev", azp: "11111111-1111-1111-1111-111111111111");

        Assert.False(MobileAccess.CanAccessMobileSurface(user, options));
    }

    [Fact]
    public void EmptyAllowedClients_SkipsTheClientCheck_ScopeAloneDecides()
    {
        var options = new MobileOptions { RequiredScopes = ["Origination.Mobile.Dev"], AllowedClientAppIds = [] };

        Assert.True(MobileAccess.CanAccessMobileSurface(Principal(scp: "Origination.Mobile.Dev", azp: "anything"), options));
        Assert.False(MobileAccess.CanAccessMobileSurface(Principal(scp: "Origination.Application.Dev", azp: "anything"), options));
    }

    [Fact]
    public void Unauthenticated_IsRejectedEverywhere()
    {
        var user = Principal(scp: "Origination.Mobile.Dev", azp: "11111111-1111-1111-1111-111111111111", authenticated: false);

        Assert.False(MobileAccess.CanAccessMobileSurface(user, Configured));
        Assert.False(MobileAccess.CanAccessDesktopSurface(user, Configured));
    }

    /// <summary>
    /// DesktopAccess is added by convention to EVERY non-mobile controller, including the BarChart
    /// ingestion endpoints that Azure Data Factory calls with an app-only token (roles, no scp, its own
    /// client id). That token must keep passing even once the mobile client ids are configured, or the
    /// production bid feed stops. Pinned here because nothing else would notice until the nightly load failed.
    /// </summary>
    [Fact]
    public void AppOnlyPipelineToken_StillReachesTheDesktopSurface_WhenMobileClientsAreConfigured()
    {
        var identity = new ClaimsIdentity(
        [
            new Claim("roles", "Origination.BarchartIngest"),
            new Claim("azp", "33333333-3333-3333-3333-333333333333"), // the pipeline's own identity
            new Claim("oid", "pipeline-sp-oid"),
            new Claim("idtyp", "app"),
        ], "Bearer");
        var pipeline = new ClaimsPrincipal(identity);

        Assert.False(MobileAccess.IsMobileToken(pipeline, Configured));
        Assert.True(MobileAccess.CanAccessDesktopSurface(pipeline, Configured));
        Assert.False(MobileAccess.CanAccessMobileSurface(pipeline, Configured));
    }

    [Fact]
    public void Scopes_AreSpaceSeparated_AndCaseInsensitive()
    {
        var user = Principal(scp: "User.Read origination.mobile.dev offline_access");

        Assert.True(MobileAccess.HasMobileScope(user, ["Origination.Mobile.Dev"]));
        Assert.Equal(3, MobileAccess.GetScopes(user).Count);
    }

    [Fact]
    public void ClientAppId_FallsBackToAppidClaim()
    {
        var identity = new ClaimsIdentity([new Claim("appid", "abc")], "Bearer");
        Assert.Equal("abc", MobileAccess.GetClientAppId(new ClaimsPrincipal(identity)));
    }

    [Fact]
    public void ObjectId_ReadsOidClaim()
    {
        Assert.Equal("user-oid", MobileAccess.GetObjectId(Principal()));
    }

    // ── Shared sign-in: Burdi's model (user 2026-10-15) ──────────────────────────────────────────────

    private const string DesktopSpa = "e0f25943-ae8b-4c2d-8060-c9ffbd448aff";

    private static readonly MobileOptions Shared = new()
    {
        SharedSignIn = true,
        RequiredScopes = ["Origination.Application.Dev"],
        AllowedClientAppIds = [DesktopSpa],
    };

    [Fact]
    public void Shared_TheDesktopSignIn_ReachesBothSurfaces()
    {
        var user = Principal(scp: "Origination.Application.Dev", azp: DesktopSpa);

        Assert.True(MobileAccess.CanAccessMobileSurface(user, Shared));
        Assert.True(MobileAccess.CanAccessDesktopSurface(user, Shared));
    }

    [Fact]
    public void Shared_ATokenIssuedToAnotherApp_IsRefusedOnMobile()
    {
        // Another app in the tenant granted the same scope must not reach api/mobile/v1.
        var user = Principal(scp: "Origination.Application.Dev", azp: "33333333-3333-3333-3333-333333333333");

        Assert.False(MobileAccess.CanAccessMobileSurface(user, Shared));
    }

    [Fact]
    public void Shared_ATokenWithoutTheScope_IsRefusedOnMobile()
    {
        Assert.False(MobileAccess.CanAccessMobileSurface(Principal(scp: "User.Read", azp: DesktopSpa), Shared));
    }

    [Fact]
    public void Shared_Unauthenticated_ReachesNeither()
    {
        var user = Principal(scp: "Origination.Application.Dev", azp: DesktopSpa, authenticated: false);

        Assert.False(MobileAccess.CanAccessMobileSurface(user, Shared));
        Assert.False(MobileAccess.CanAccessDesktopSurface(user, Shared));
    }

    [Fact]
    public void TheDesktopScope_WithoutSharedSignIn_WouldLockTheDesktopOut()
    {
        // Why SharedSignIn exists: the startup check logs MOBILE_SCOPE_MISCONFIGURED for exactly this setup.
        var misconfigured = new MobileOptions { RequiredScopes = ["Origination.Application.Dev"], AllowedClientAppIds = [DesktopSpa] };

        Assert.False(MobileAccess.CanAccessDesktopSurface(Principal(scp: "Origination.Application.Dev", azp: DesktopSpa), misconfigured));
    }
}
