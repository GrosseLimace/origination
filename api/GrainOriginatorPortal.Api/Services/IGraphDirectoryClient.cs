namespace GrainOriginatorPortal.Api.Services;

/// <summary>How a Microsoft Graph read ended — the spike's real deliverable. Each failure mode
/// maps to a different remediation, so callers surface this verbatim instead of a generic error.</summary>
public enum GraphReadStatus
{
    Ok,
    /// <summary>Could not acquire a token at all (identity problem) — no HTTP request was sent.</summary>
    TokenFailure,
    /// <summary>Network-level failure reaching graph.microsoft.com — on App Service this almost
    /// certainly means the zero-trust NSG needs a custom outbound rule for graph.microsoft.com:443.</summary>
    EgressBlocked,
    /// <summary>Graph answered 401/403 — the identity lacks the app-role grant
    /// (GroupMember.Read.All for group member reads).</summary>
    PermissionMissing,
    /// <summary>The group id/name doesn't resolve to an object.</summary>
    NotFound,
    /// <summary>Any other non-success Graph response (see HttpStatus).</summary>
    Error
}

/// <summary>Outcome envelope for a Graph read: categorized status, the raw HTTP status when a
/// response was received, a remediation hint, and the value on success.</summary>
public sealed record GraphReadResult<T>
{
    public GraphReadStatus Status { get; init; }
    public bool Ok => Status == GraphReadStatus.Ok;
    public int? HttpStatus { get; init; }
    public string? Detail { get; init; }
    public T? Value { get; init; }
}

public sealed record GraphGroupRef(string Id, string? DisplayName);

public sealed record GraphUser(string Id, string? DisplayName, string? UserPrincipalName, bool? AccountEnabled);

/// <summary>
/// Minimal Microsoft Graph directory reader. Auth: an injected <see cref="Azure.Core.TokenCredential"/>
/// (system-assigned managed identity on App Service; the developer's own credential locally) with
/// scope https://graph.microsoft.com/.default — the token is acquired in-service (not a handler) so
/// credential failures are reported as <see cref="GraphReadStatus.TokenFailure"/> rather than being
/// retried/wrapped by the HTTP resilience pipeline. No Graph SDK — named HttpClient + JSON.
/// </summary>
public interface IGraphDirectoryClient
{
    /// <summary>Resolves a group by exact display name. Empty result → NotFound.</summary>
    Task<GraphReadResult<GraphGroupRef>> FindGroupByNameAsync(string displayName, CancellationToken cancellationToken);

    /// <summary>All transitive USER members of a group (nested groups flattened; devices/SPs excluded).</summary>
    Task<GraphReadResult<List<GraphUser>>> GetGroupTransitiveUserMembersAsync(string groupId, CancellationToken cancellationToken);
}
