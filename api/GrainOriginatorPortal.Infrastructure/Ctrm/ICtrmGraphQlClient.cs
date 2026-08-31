namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>How a CTRM GraphQL read ended. Each failure mode maps to a different remediation, so
/// callers surface this rather than a generic error.
///
/// GraphQL needs more than the HTTP status to classify an outcome: this API returns HTTP 500 for
/// caller-input validation failures, HTTP 200 with a top-level <c>errors</c> array for query
/// problems, and (when the Application Gateway WAF rejects a request) an HTML body no JSON parser
/// will accept. The body is therefore always inspected, whatever the status code says.</summary>
public enum CtrmReadStatus
{
    Ok,

    /// <summary>Response carried BOTH <c>data</c> and <c>errors</c> — some fields resolved, some
    /// did not. Treated as usable (<see cref="CtrmReadResult{T}.Ok"/> is true) but the detail is
    /// still populated so the partial failure is visible in logs.</summary>
    PartialSuccess,

    /// <summary>No endpoint/credential configured — the CTRM path is switched off. No HTTP request
    /// was sent and callers should fall back to ODS silently.</summary>
    NotConfigured,

    /// <summary>A contract-window snapshot build is in progress and no usable cached copy exists yet.
    /// Returned INSTEAD of waiting: the walk can take minutes, and blocking a request on it makes the
    /// screen look hung. Callers show nothing and the provenance header reports the state, so a retry a
    /// few moments later succeeds.</summary>
    Warming,

    /// <summary>Could not acquire a token at all (identity or secret problem) — no HTTP request was
    /// sent.</summary>
    TokenFailure,

    /// <summary>Network-level failure reaching the gateway. On App Service this almost certainly
    /// means the zero-trust NSG needs a custom outbound rule; the on-prem node sits behind APIM
    /// rather than on the public internet.</summary>
    EgressBlocked,

    /// <summary>APIM answered 401/403. Either the client secret is stale or the app registration
    /// lacks the role on the CTRM API.</summary>
    Unauthorized,

    /// <summary>APIM answered 429. Its own status because batched ticket reads are the likely
    /// trigger, and the remedy is a smaller batch rather than a retry.</summary>
    Throttled,

    /// <summary>The service answered with a GraphQL <c>errors</c> array and no usable data. Note
    /// the message is frequently masked ("An internal error occurred") with only
    /// <see cref="CtrmReadResult{T}.ErrorCode"/> to go on.</summary>
    QueryError,

    /// <summary>Any other non-success response — including an HTML body, which indicates the WAF
    /// rejected the request before it reached the API.</summary>
    Error
}

/// <summary>Outcome envelope for a CTRM read: categorized status, the raw HTTP status when a
/// response was received, a remediation hint, the GraphQL error code when one survived, and the
/// deserialized value on success.</summary>
public sealed record CtrmReadResult<T>
{
    public CtrmReadStatus Status { get; init; }

    /// <summary>True for <see cref="CtrmReadStatus.Ok"/> and
    /// <see cref="CtrmReadStatus.PartialSuccess"/> — both leave <see cref="Value"/> usable.</summary>
    public bool Ok => Status is CtrmReadStatus.Ok or CtrmReadStatus.PartialSuccess;

    public int? HttpStatus { get; init; }

    /// <summary>Operator-facing remediation hint, not a user-facing message.</summary>
    public string? Detail { get; init; }

    /// <summary>The <c>extensions.code</c> from the first GraphQL error, when present. Often the
    /// only usable signal, since this API masks the message text on coercion and parse failures
    /// (<c>HC0018</c>, <c>HC0012</c>) while still returning the framework's code.</summary>
    public string? ErrorCode { get; init; }

    public T? Value { get; init; }

    /// <summary>Where the rows came from when it was NOT a live fetch. <c>null</c> means live (or a
    /// coalesced share of a live fetch); <see cref="CtrmReadOrigin.TradeUnitCache"/> means a warm
    /// trade-unit producer-set cache answered a per-producer read instantly, with the live read
    /// refreshing behind it. Recorded in provenance so a fast click is attributable.</summary>
    public string? Origin { get; init; }
}

/// <summary>Values for <see cref="CtrmReadResult{T}.Origin"/>.</summary>
public static class CtrmReadOrigin
{
    public const string TradeUnitCache = "tradeUnitCache";
}

/// <summary>
/// Minimal client for the DB2Connector.GraphQL API (CTRM contracts and tickets over Db2 for i).
///
/// Auth is Entra ID client credentials against the API's own app registration. The token is
/// acquired in-service rather than in a <c>DelegatingHandler</c> — deliberately, so credential
/// failures surface as <see cref="CtrmReadStatus.TokenFailure"/> instead of being retried and
/// re-wrapped by the HTTP resilience pipeline. This mirrors
/// <c>GrainOriginatorPortal.Api.Services.IGraphDirectoryClient</c>.
///
/// The interface lives in Infrastructure (where the repositories that consume it live) while the
/// implementation lives in Api, which already references Azure.Identity and
/// Microsoft.Extensions.Http.
/// </summary>
public interface ICtrmGraphQlClient
{
    /// <summary>False when no endpoint or credential is configured. Lets callers skip straight to
    /// ODS without paying for a request that cannot succeed.</summary>
    bool IsConfigured { get; }

    /// <summary>Executes a query document with optional variables and deserializes the
    /// <c>data</c> object into <typeparamref name="T"/>.
    ///
    /// Query documents must contain NO <c>#</c> comment lines: the WAF in front of this API has
    /// been observed rejecting bodies containing them (OWASP rules read <c>#</c> as a SQL comment
    /// sequence), returning an HTML 403 the API never sees.</summary>
    Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken);
}
