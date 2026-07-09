// Project namespaces
using GrainOriginatorPortal.Api.Middleware;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// Guards the SPA Content-Security-Policy: the map tile hosts must stay allowed in img-src, and the
/// localhost dev origins must NEVER appear in a non-development (deployed) policy (CWE-942).
/// </summary>
public class SecurityHeadersCspTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Csp_AllowsMapTileHosts_InImgSrc(bool isDevelopment)
    {
        var csp = SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy(isDevelopment);

        Assert.Contains("https://*.tile.openstreetmap.org", csp);   // street tiles
        Assert.Contains("https://server.arcgisonline.com", csp);    // Esri satellite/aerial tiles
        // Both belong to img-src (tiles are <img> requests), not connect-src.
        var imgSrc = csp.Split(';').Single(d => d.TrimStart().StartsWith("img-src"));
        Assert.Contains("https://server.arcgisonline.com", imgSrc);
    }

    [Fact]
    public void Csp_Production_DoesNotIncludeLocalhostOrigins()
    {
        var csp = SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy(isDevelopment: false);

        Assert.DoesNotContain("localhost", csp);
    }

    [Fact]
    public void Csp_Development_IncludesLocalhostConnectOrigins()
    {
        var csp = SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy(isDevelopment: true);

        Assert.Contains("http://localhost:5000", csp);
        Assert.Contains("https://localhost:*", csp);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Csp_NeverContainsAzureWildcard(bool isDevelopment)
    {
        // M-025: the *.azurewebsites.net wildcard allowed exfiltration to any Azure site. It must
        // be gone in every environment, whether or not specific connect hosts are configured.
        var csp = SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy(
            isDevelopment, new[] { "https://app-origination-eus.azurewebsites.net" });

        Assert.DoesNotContain("*.azurewebsites.net", csp);
    }

    [Fact]
    public void Csp_IncludesConfiguredConnectHost_InConnectSrc()
    {
        var host = "https://app-origination-eus.azurewebsites.net";
        var csp = SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy(isDevelopment: false, new[] { host });

        var connectSrc = csp.Split(';').Single(d => d.TrimStart().StartsWith("connect-src"));
        Assert.Contains(host, connectSrc);
        Assert.Contains("'self'", connectSrc);
    }

    [Fact]
    public void Csp_WithNoConfiguredHosts_ConnectSrcHasOnlySelfAndMicrosoft()
    {
        // Empty host list (e.g. base config / local) → no third-party API host beyond Microsoft login/graph.
        var csp = SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy(isDevelopment: false);

        var connectSrc = csp.Split(';').Single(d => d.TrimStart().StartsWith("connect-src"));
        Assert.DoesNotContain("azurewebsites.net", connectSrc);
        Assert.Contains("https://login.microsoftonline.com", connectSrc);
        Assert.Contains("https://graph.microsoft.com", connectSrc);
    }
}
