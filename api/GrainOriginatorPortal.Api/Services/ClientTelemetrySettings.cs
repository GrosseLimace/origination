namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Whether the browser app sends its errors to Application Insights, and where.
///
/// Reuses the connection string App Service already holds for the server's auto-instrumentation
/// (<c>APPLICATIONINSIGHTS_CONNECTION_STRING</c>), so browser and server telemetry land in the same
/// resource and no environment file carries a copy. Microsoft classes the connection string as
/// non-secret: it says where to send telemetry and allows writes only. It is still served only to
/// signed-in users (see <c>ClientTelemetryController</c>).
///
/// <see cref="IngestionOrigin"/> is the one host the browser posts to. The CSP allows exactly that
/// origin rather than the <c>*.in.applicationinsights.azure.com</c> wildcard, which would let
/// injected script post data to any App Insights resource, including one an attacker owns.
/// </summary>
public sealed class ClientTelemetrySettings
{
    public const string ConnectionStringKey = "APPLICATIONINSIGHTS_CONNECTION_STRING";
    public const string EnabledKey = "ClientTelemetry:Enabled";

    /// <summary>Null when browser telemetry is off: switched off in config, no connection string,
    /// or a connection string without a usable ingestion endpoint.</summary>
    public string? ConnectionString { get; }

    /// <summary>The ingestion origin, e.g. <c>https://eastus-8.in.applicationinsights.azure.com</c>.
    /// Null whenever <see cref="ConnectionString"/> is.</summary>
    public string? IngestionOrigin { get; }

    private ClientTelemetrySettings(string? connectionString, string? ingestionOrigin)
    {
        ConnectionString = connectionString;
        IngestionOrigin = ingestionOrigin;
    }

    public static ClientTelemetrySettings From(IConfiguration config)
    {
        // On unless switched off: the app setting ClientTelemetry__Enabled=false turns it off in one
        // environment without a deploy.
        if (!config.GetValue(EnabledKey, true)) return Off;

        var connectionString = config[ConnectionStringKey];
        var origin = IngestionOriginOf(connectionString);
        return origin is null ? Off : new ClientTelemetrySettings(connectionString, origin);
    }

    private static readonly ClientTelemetrySettings Off = new(null, null);

    /// <summary>The scheme and host of the connection string's IngestionEndpoint, when it is an
    /// HTTPS Azure Monitor ingestion host. Anything else yields null and telemetry stays off: a
    /// connection string without an IngestionEndpoint (the old instrumentation-key-only form) would
    /// fall back to a global endpoint this CSP does not allow, so it is treated as unusable rather
    /// than half-working.</summary>
    public static string? IngestionOriginOf(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString)) return null;

        foreach (var part in connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var eq = part.IndexOf('=');
            if (eq <= 0 || !part[..eq].Trim().Equals("IngestionEndpoint", StringComparison.OrdinalIgnoreCase)) continue;

            if (!Uri.TryCreate(part[(eq + 1)..].Trim(), UriKind.Absolute, out var uri)) return null;
            if (uri.Scheme != Uri.UriSchemeHttps) return null;
            if (!uri.Host.EndsWith(".applicationinsights.azure.com", StringComparison.OrdinalIgnoreCase)) return null;
            return $"{uri.Scheme}://{uri.Host}";
        }
        return null;
    }
}
