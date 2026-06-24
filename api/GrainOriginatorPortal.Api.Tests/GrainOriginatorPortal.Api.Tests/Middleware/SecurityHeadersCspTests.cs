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
}
