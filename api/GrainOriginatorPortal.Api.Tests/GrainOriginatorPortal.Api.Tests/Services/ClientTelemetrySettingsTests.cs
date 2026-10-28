// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The browser reports errors to the App Insights resource the server already uses, and the CSP
/// lets it reach that one ingestion host and nothing wider. These pin when telemetry is on, which
/// host is allowed, and that a malformed or foreign endpoint turns it off rather than opening the CSP.
/// </summary>
public class ClientTelemetrySettingsTests
{
    // Shaped like a real workspace-based connection string; the GUIDs are made up.
    private const string ConnectionString =
        "InstrumentationKey=00000000-0000-0000-0000-000000000000;" +
        "IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;" +
        "LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;" +
        "ApplicationId=11111111-1111-1111-1111-111111111111";

    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    [Fact]
    public void IsOnWithTheServersConnectionString_AndAllowsOnlyItsIngestionHost()
    {
        var settings = ClientTelemetrySettings.From(Config((ClientTelemetrySettings.ConnectionStringKey, ConnectionString)));

        Assert.Equal(ConnectionString, settings.ConnectionString);
        Assert.Equal("https://eastus-8.in.applicationinsights.azure.com", settings.IngestionOrigin);
    }

    [Fact]
    public void IsOffWhenThereIsNoConnectionString()
    {
        var settings = ClientTelemetrySettings.From(Config());

        Assert.Null(settings.ConnectionString);
        Assert.Null(settings.IngestionOrigin);
    }

    [Fact]
    public void IsOffWhenSwitchedOffEvenWithAConnectionString()
    {
        var settings = ClientTelemetrySettings.From(Config(
            (ClientTelemetrySettings.ConnectionStringKey, ConnectionString),
            (ClientTelemetrySettings.EnabledKey, "false")));

        Assert.Null(settings.ConnectionString);
        Assert.Null(settings.IngestionOrigin);
    }

    [Theory]
    // The old instrumentation-key-only form: the SDK would fall back to a global endpoint the CSP does not allow.
    [InlineData("InstrumentationKey=00000000-0000-0000-0000-000000000000")]
    [InlineData("InstrumentationKey=x;IngestionEndpoint=http://eastus-8.in.applicationinsights.azure.com/")]
    [InlineData("InstrumentationKey=x;IngestionEndpoint=https://collector.example.com/")]
    [InlineData("InstrumentationKey=x;IngestionEndpoint=https://applicationinsights.azure.com.example.com/")]
    [InlineData("InstrumentationKey=x;IngestionEndpoint=not a url")]
    public void IsOffForAnEndpointThatIsNotAnHttpsAzureIngestionHost(string connectionString)
    {
        var settings = ClientTelemetrySettings.From(Config((ClientTelemetrySettings.ConnectionStringKey, connectionString)));

        Assert.Null(settings.ConnectionString);
        Assert.Null(settings.IngestionOrigin);
    }

    [Fact]
    public void TheCspConnectHostsGainTheIngestionHostOnlyWhenTelemetryIsOn()
    {
        const string apiHost = "https://app-origination-dev-eus.azurewebsites.net";

        var on = SecurityHeadersMiddleware.SpaConnectHosts(Config(
            ("SecurityHeaders:SpaConnectSrcHosts:0", apiHost),
            (ClientTelemetrySettings.ConnectionStringKey, ConnectionString)));
        var off = SecurityHeadersMiddleware.SpaConnectHosts(Config(
            ("SecurityHeaders:SpaConnectSrcHosts:0", apiHost)));

        Assert.Equal([apiHost, "https://eastus-8.in.applicationinsights.azure.com"], on);
        Assert.Equal([apiHost], off);
        var csp = SecurityHeadersMiddleware.BuildSpaContentSecurityPolicy(isDevelopment: false, on);
        Assert.DoesNotContain("*.in.applicationinsights.azure.com", csp);
    }

    [Fact]
    public void TheEndpointHandsTheBrowserTheConnectionStringOrNull()
    {
        var on = new ClientTelemetryController(ClientTelemetrySettings.From(Config((ClientTelemetrySettings.ConnectionStringKey, ConnectionString))));
        var off = new ClientTelemetryController(ClientTelemetrySettings.From(Config()));

        Assert.Equal(ConnectionString, Assert.IsType<ClientTelemetryResponse>(Assert.IsType<OkObjectResult>(on.Get().Result).Value).ConnectionString);
        Assert.Null(Assert.IsType<ClientTelemetryResponse>(Assert.IsType<OkObjectResult>(off.Get().Result).Value).ConnectionString);
    }
}
