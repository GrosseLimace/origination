using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using Polly.CircuitBreaker;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class GraphDirectoryClient : IGraphDirectoryClient
{
    private static readonly string[] Scopes = ["https://graph.microsoft.com/.default"];

    private readonly TokenCredential _credential;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<GraphDirectoryClient> _logger;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private AccessToken _cachedToken; // default ExpiresOn == MinValue → always stale until first acquire

    public GraphDirectoryClient(
        TokenCredential credential,
        IHttpClientFactory httpFactory,
        ILogger<GraphDirectoryClient> logger)
    {
        _credential = credential;
        _httpFactory = httpFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<GraphReadResult<GraphGroupRef>> GetGroupByIdAsync(string groupId, CancellationToken cancellationToken)
    {
        // Direct object GET — no $filter/search, so it works under a group-scoped grant.
        var result = await GetPagedAsync($"groups/{Uri.EscapeDataString(groupId)}?$select=id,displayName", cancellationToken);
        if (!result.Ok)
            return Propagate<GraphGroupRef>(result);

        var group = result.Value!
            .Select(el => new GraphGroupRef(
                el.GetProperty("id").GetString()!,
                el.TryGetProperty("displayName", out var dn) ? dn.GetString() : null))
            .FirstOrDefault();

        return group is null
            ? new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.NotFound,
                HttpStatus = result.HttpStatus,
                Detail = $"No Entra group has the object id '{groupId}'."
            }
            : new GraphReadResult<GraphGroupRef> { Status = GraphReadStatus.Ok, HttpStatus = result.HttpStatus, Value = group };
    }

    /// <inheritdoc />
    public async Task<GraphReadResult<GraphGroupRef>> FindGroupByNameAsync(string displayName, CancellationToken cancellationToken)
    {
        var filter = Uri.EscapeDataString($"displayName eq '{EscapeODataLiteral(displayName)}'");
        var result = await GetPagedAsync($"groups?$filter={filter}&$select=id,displayName", cancellationToken);
        if (!result.Ok)
            return Propagate<GraphGroupRef>(result);

        var group = result.Value!
            .Select(el => new GraphGroupRef(
                el.GetProperty("id").GetString()!,
                el.TryGetProperty("displayName", out var dn) ? dn.GetString() : null))
            .FirstOrDefault();

        return group is null
            ? new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.NotFound,
                HttpStatus = result.HttpStatus,
                Detail = $"No Entra group has the display name '{displayName}' (names are matched exactly)."
            }
            : new GraphReadResult<GraphGroupRef> { Status = GraphReadStatus.Ok, HttpStatus = result.HttpStatus, Value = group };
    }

    /// <inheritdoc />
    public async Task<GraphReadResult<List<GraphUser>>> GetGroupTransitiveUserMembersAsync(string groupId, CancellationToken cancellationToken)
    {
        // The /microsoft.graph.user cast returns only user objects — nested groups are flattened
        // by transitiveMembers, devices/service principals are excluded by the cast.
        var url = $"groups/{Uri.EscapeDataString(groupId)}/transitiveMembers/microsoft.graph.user" +
                  "?$select=id,displayName,userPrincipalName,accountEnabled&$top=999";
        var result = await GetPagedAsync(url, cancellationToken);
        if (!result.Ok)
            return Propagate<List<GraphUser>>(result);

        var users = result.Value!
            .Select(el => new GraphUser(
                el.GetProperty("id").GetString()!,
                el.TryGetProperty("displayName", out var dn) ? dn.GetString() : null,
                el.TryGetProperty("userPrincipalName", out var upn) ? upn.GetString() : null,
                el.TryGetProperty("accountEnabled", out var ae) && ae.ValueKind != JsonValueKind.Null ? ae.GetBoolean() : null))
            .ToList();

        return new GraphReadResult<List<GraphUser>> { Status = GraphReadStatus.Ok, HttpStatus = result.HttpStatus, Value = users };
    }

    // -------------------------------------------------------------------------

    /// <summary>Runs a GET against Graph following @odata.nextLink paging, categorizing every
    /// failure mode (see <see cref="GraphReadStatus"/>). Never throws for expected failures.</summary>
    private async Task<GraphReadResult<List<JsonElement>>> GetPagedAsync(string url, CancellationToken cancellationToken)
    {
        string token;
        try
        {
            token = await GetBearerTokenAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is CredentialUnavailableException or AuthenticationFailedException)
        {
            _logger.LogError("Graph token acquisition failed [{ErrorCode}] [{ErrorCategory}]: {ExceptionType}",
                "INFRASTRUCTURE_GRAPH_TOKEN", "Infrastructure", ex.GetType().Name);
            return Fail(GraphReadStatus.TokenFailure, null,
                $"Could not acquire a Graph token ({ex.GetType().Name}) — identity/credential problem, no request was sent.");
        }

        var items = new List<JsonElement>();
        string? nextUrl = url;
        try
        {
            var http = _httpFactory.CreateClient("graph");
            while (nextUrl is not null)
            {
                // @odata.nextLink is absolute; relative first-page URLs resolve against BaseAddress.
                using var request = new HttpRequestMessage(HttpMethod.Get, nextUrl);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var response = await http.SendAsync(request, cancellationToken);

                if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                    return Fail(GraphReadStatus.PermissionMissing, (int)response.StatusCode,
                        "Graph refused the read — this identity needs the GroupMember.Read.All application " +
                        "role granted (same procedure as the Logic Apps' Mail.Send grant).");
                if (response.StatusCode == HttpStatusCode.NotFound)
                    return Fail(GraphReadStatus.NotFound, 404, "Graph object not found — check the group id/name.");
                if (!response.IsSuccessStatusCode)
                    return Fail(GraphReadStatus.Error, (int)response.StatusCode,
                        $"Unexpected Graph response {(int)response.StatusCode}.");

                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                if (doc.RootElement.TryGetProperty("value", out var collection))
                {
                    // Collection response (list/members) — accumulate and follow paging.
                    foreach (var element in collection.EnumerateArray())
                        items.Add(element.Clone()); // Clone — the document is disposed per page
                }
                else
                {
                    // Single-object response (direct GET /groups/{id}) — one item, no paging.
                    items.Add(doc.RootElement.Clone());
                }

                nextUrl = doc.RootElement.TryGetProperty("@odata.nextLink", out var next) ? next.GetString() : null;
            }

            return new GraphReadResult<List<JsonElement>> { Status = GraphReadStatus.Ok, HttpStatus = 200, Value = items };
        }
        catch (BrokenCircuitException)
        {
            return Fail(GraphReadStatus.EgressBlocked, null,
                "Circuit open after repeated failures reaching graph.microsoft.com — likely blocked egress.");
        }
        catch (HttpRequestException ex)
        {
            return Fail(GraphReadStatus.EgressBlocked, null,
                $"Network failure reaching graph.microsoft.com ({ex.HttpRequestError}) — on App Service this " +
                "means the NSG needs a custom outbound rule for graph.microsoft.com:443.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Fail(GraphReadStatus.EgressBlocked, null,
                "Timed out reaching graph.microsoft.com — on App Service this means the NSG needs a " +
                "custom outbound rule for graph.microsoft.com:443.");
        }
    }

    private GraphReadResult<List<JsonElement>> Fail(GraphReadStatus status, int? httpStatus, string detail)
    {
        // Outcome + status only — no group names or member data in logs.
        _logger.LogWarning("Graph read failed [{ErrorCode}] [{ErrorCategory}]: {Status} (HTTP {HttpStatus})",
            "INFRASTRUCTURE_GRAPH_UNAVAILABLE", "Infrastructure", status, httpStatus);
        return new GraphReadResult<List<JsonElement>> { Status = status, HttpStatus = httpStatus, Detail = detail };
    }

    private static GraphReadResult<T> Propagate<T>(GraphReadResult<List<JsonElement>> failed) =>
        new() { Status = failed.Status, HttpStatus = failed.HttpStatus, Detail = failed.Detail };

    private async Task<string> GetBearerTokenAsync(CancellationToken cancellationToken)
    {
        if (_cachedToken.ExpiresOn > DateTimeOffset.UtcNow.AddMinutes(5))
            return _cachedToken.Token;

        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (_cachedToken.ExpiresOn <= DateTimeOffset.UtcNow.AddMinutes(5))
                _cachedToken = await _credential.GetTokenAsync(new TokenRequestContext(Scopes), cancellationToken);
            return _cachedToken.Token;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    /// <summary>OData string literals escape embedded single quotes by doubling them.</summary>
    internal static string EscapeODataLiteral(string value) => value.Replace("'", "''");
}
