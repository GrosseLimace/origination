using System.Net.Http.Headers;
using System.Text.Json;
using Azure.Core;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class AppAccessUserService : IAppAccessUserService
{
    private const string GraphScope = "https://graph.microsoft.com/.default";
    private const string ConfigKey = "UsageDashboard:AppAccessGroupObjectId";

    private readonly HttpClient _httpClient;
    private readonly TokenCredential _credential;
    private readonly IConfiguration _config;
    private readonly ILogger<AppAccessUserService> _logger;

    public AppAccessUserService(
        HttpClient httpClient,
        TokenCredential credential,
        IConfiguration config,
        ILogger<AppAccessUserService> logger)
    {
        _httpClient = httpClient;
        _credential = credential;
        _config = config;
        _logger = logger;
    }

    /// <summary>UPN → short name: strip any "@domain" so it matches the entitlements/usage key
    /// (e.g. "CEgr@scoular.com" → "CEgr").</summary>
    public static string ToShortName(string upn) =>
        string.IsNullOrEmpty(upn) ? string.Empty
        : upn.Contains('@') ? upn.Split('@')[0] : upn;

    /// <inheritdoc />
    public async Task<IReadOnlySet<string>?> GetAppAccessUserShortNamesAsync(CancellationToken cancellationToken = default)
    {
        var groupId = _config[ConfigKey];
        if (string.IsNullOrWhiteSpace(groupId))
        {
            _logger.LogInformation(
                "App-access group filter disabled (no {ConfigKey}) — Usage Dashboard will include all entitlements users.",
                ConfigKey);
            return null;
        }

        try
        {
            var token = await _credential.GetTokenAsync(
                new TokenRequestContext(new[] { GraphScope }), cancellationToken);

            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // transitiveMembers/microsoft.graph.user: flattens nested groups and excludes
            // service principals / group objects; $top=999 is Graph's max page size.
            var url = $"https://graph.microsoft.com/v1.0/groups/{Uri.EscapeDataString(groupId)}/transitiveMembers/microsoft.graph.user?$select=userPrincipalName&$top=999";

            while (!string.IsNullOrEmpty(url))
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);

                using var response = await _httpClient.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning(
                        "Graph group-member lookup failed ({Status}) for group {GroupId} — Usage Dashboard will fall back to all entitlements users. [{ErrorCode}]",
                        (int)response.StatusCode, groupId, "GRAPH_GROUP_LOOKUP_FAILED");
                    return null;
                }

                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                var root = doc.RootElement;

                if (root.TryGetProperty("value", out var values) && values.ValueKind == JsonValueKind.Array)
                {
                    foreach (var member in values.EnumerateArray())
                    {
                        if (member.TryGetProperty("userPrincipalName", out var upnEl)
                            && upnEl.ValueKind == JsonValueKind.String)
                        {
                            var shortName = ToShortName(upnEl.GetString() ?? string.Empty);
                            if (!string.IsNullOrEmpty(shortName)) result.Add(shortName);
                        }
                    }
                }

                url = root.TryGetProperty("@odata.nextLink", out var next) && next.ValueKind == JsonValueKind.String
                    ? next.GetString()
                    : null;
            }

            _logger.LogInformation("Resolved {Count} app-access users from group {GroupId}.", result.Count, groupId);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Error resolving app-access group {GroupId} from Graph — Usage Dashboard will fall back to all entitlements users. [{ErrorCode}]",
                groupId, "GRAPH_GROUP_LOOKUP_FAILED");
            return null;
        }
    }
}
