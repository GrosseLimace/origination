using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using Polly.CircuitBreaker;

namespace GrainOriginatorPortal.Api.Services.Ctrm;

/// <inheritdoc />
public sealed class CtrmGraphQlClient : ICtrmGraphQlClient
{
    /// <summary>Named client registered in Program.cs — BaseAddress is the full GraphQL URL.</summary>
    public const string HttpClientName = "ctrm";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,

        // CTRM's timestamp fields are space-separated ("2026-08-01 00:32:53"), which the built-in
        // reader rejects outright — one such value on one price line failed an entire contracts page.
        Converters = { new CtrmNullableDateTimeConverter(), new CtrmDateTimeConverter() }
    };

    private readonly TokenCredential? _credential;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<CtrmGraphQlClient> _logger;
    private readonly string[] _scopes;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private AccessToken _cachedToken; // default ExpiresOn == MinValue → always stale until first acquire

    public CtrmGraphQlClient(
        TokenCredential? credential,
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        ILogger<CtrmGraphQlClient> logger)
    {
        _credential = credential;
        _httpFactory = httpFactory;
        _logger = logger;

        var uri = configuration.GetValue<string>("Ctrm:GraphQlUri")?.Trim();
        var audience = configuration.GetValue<string>("Ctrm:Audience")?.Trim();
        _scopes = string.IsNullOrEmpty(audience) ? [] : [audience];

        // All three have to be present for a request to have any chance of succeeding. Base
        // appsettings leaves them empty on purpose, so an unconfigured environment reports
        // NotConfigured and its caller falls back to ODS rather than failing.
        IsConfigured = !string.IsNullOrEmpty(uri) && !string.IsNullOrEmpty(audience) && credential is not null;
    }

    /// <inheritdoc />
    public bool IsConfigured { get; }

    /// <inheritdoc />
    public async Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
    {
        if (!IsConfigured)
            return new CtrmReadResult<T>
            {
                Status = CtrmReadStatus.NotConfigured,
                Detail = "Ctrm:GraphQlUri, Ctrm:Audience or the client credential is not configured — no request sent."
            };

        string token;
        try
        {
            token = await GetBearerTokenAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is CredentialUnavailableException or AuthenticationFailedException)
        {
            _logger.LogError("CTRM token acquisition failed [{ErrorCode}] [{ErrorCategory}]: {ExceptionType}",
                "INFRASTRUCTURE_CTRM_TOKEN", "Infrastructure", ex.GetType().Name);
            return Fail<T>(CtrmReadStatus.TokenFailure, null, null,
                $"Could not acquire a CTRM token ({ex.GetType().Name}) — check the Ctrm--ClientSecret Key Vault " +
                "secret and that the app registration holds a role on the CTRM API. No request was sent.");
        }

        string body;
        int httpStatus;
        try
        {
            var http = _httpFactory.CreateClient(HttpClientName);
            var payload = JsonSerializer.Serialize(new { query = document, variables });

            using var request = new HttpRequestMessage(HttpMethod.Post, string.Empty)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using var response = await http.SendAsync(request, cancellationToken);
            httpStatus = (int)response.StatusCode;
            body = await response.Content.ReadAsStringAsync(cancellationToken);

            // Deliberately NOT short-circuiting on !IsSuccessStatusCode. This API answers HTTP 500
            // for caller-input validation failures while still returning a well-formed GraphQL
            // errors array, so the body is worth parsing whatever the status says. The exceptions
            // are handled below: 401/403 (APIM, not GraphQL) and an HTML body (WAF).
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden
                && !LooksLikeHtml(body))
                return Fail<T>(CtrmReadStatus.Unauthorized, httpStatus, null,
                    "APIM refused the request — either the Ctrm--ClientSecret Key Vault secret is empty or has " +
                    "expired, or the app registration no longer holds a role on the CTRM API.");

            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                return Fail<T>(CtrmReadStatus.Throttled, httpStatus, null,
                    "APIM throttled the request — reduce Ctrm:TicketBatchLimit or the batch size before retrying. " +
                    "Do not retry immediately in a loop.");
        }
        catch (BrokenCircuitException)
        {
            return Fail<T>(CtrmReadStatus.EgressBlocked, null, null,
                "Circuit open after repeated failures reaching the CTRM gateway.");
        }
        catch (HttpRequestException ex)
        {
            // NOT the Graph story. developer-docs/NETWORK-DIAGRAM.md is explicit that calls through
            // APIM (apidev/apiqa/api.scoular.com) need NO additional NSG rule — the APIM private
            // endpoint IPs are already allowed. So pointing an operator at a custom outbound rule
            // would send them down the wrong path; the real suspects are private DNS resolution and
            // whether this environment's APIM private endpoint is in the allowed set.
            return Fail<T>(CtrmReadStatus.EgressBlocked, null, null,
                $"Network failure reaching the CTRM gateway ({ex.HttpRequestError}). APIM traffic does not need a " +
                "custom NSG outbound rule — check private DNS resolution (10.102.1.10) and that this " +
                "environment's APIM private endpoint is among the allowed IPs.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Fail<T>(CtrmReadStatus.EgressBlocked, null, null,
                "Timed out reaching the CTRM gateway. APIM traffic does not need a custom NSG outbound rule — " +
                "check private DNS resolution (10.102.1.10) and the APIM private endpoint allow-list.");
        }

        // The Application Gateway WAF returns an HTML error page, which no JSON parser will accept.
        // Detect it explicitly so the failure reads as a gateway rejection rather than malformed JSON.
        if (LooksLikeHtml(body))
            return Fail<T>(CtrmReadStatus.Error, httpStatus, null,
                $"Gateway returned HTML rather than JSON (HTTP {httpStatus}) — the WAF rejected the request " +
                "before it reached the API. Query documents must contain no '#' comment lines.");

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(body);
        }
        catch (JsonException ex)
        {
            return Fail<T>(CtrmReadStatus.Error, httpStatus, null,
                $"CTRM response was neither JSON nor HTML ({ex.Message}).");
        }

        using (doc)
        {
            var root = doc.RootElement;
            var hasData = root.TryGetProperty("data", out var data) && data.ValueKind is not JsonValueKind.Null;

            if (root.TryGetProperty("errors", out var errors)
                && errors.ValueKind == JsonValueKind.Array
                && errors.GetArrayLength() > 0)
            {
                var (message, code) = FirstError(errors);

                // data AND errors both present — some fields resolved. Usable, but the partial
                // failure is still reported so it shows up in logs rather than passing silently.
                if (hasData)
                {
                    if (!TryDeserialize<T>(data, out var partialValue, out var partialError))
                        return Fail<T>(CtrmReadStatus.Error, httpStatus, code, partialError);

                    _logger.LogWarning("CTRM query partially failed [{ErrorCode}] [{ErrorCategory}]: {GraphQlCode}",
                        "INFRASTRUCTURE_CTRM_PARTIAL", "Infrastructure", code ?? "(none)");
                    return new CtrmReadResult<T>
                    {
                        Status = CtrmReadStatus.PartialSuccess,
                        HttpStatus = httpStatus,
                        ErrorCode = code,
                        Detail = $"Partial result — GraphQL reported: {message}",
                        Value = partialValue
                    };
                }

                return Fail<T>(CtrmReadStatus.QueryError, httpStatus, code,
                    $"CTRM rejected the query: {message}"
                    + (code is null ? null : $" (code {code})"));
            }

            if (!hasData)
                return Fail<T>(CtrmReadStatus.Error, httpStatus, null,
                    $"CTRM returned neither data nor errors (HTTP {httpStatus}).");

            if (!TryDeserialize<T>(data, out var value, out var error))
                return Fail<T>(CtrmReadStatus.Error, httpStatus, null, error);

            return new CtrmReadResult<T>
            {
                Status = CtrmReadStatus.Ok,
                HttpStatus = httpStatus,
                Value = value
            };
        }
    }

    // -------------------------------------------------------------------------

    /// <summary>Pulls the message and <c>extensions.code</c> off the first GraphQL error. The code
    /// matters more than the message here: this API masks the text on coercion and parse failures
    /// ("An internal error occurred") while still returning the framework code.</summary>
    private static (string Message, string? Code) FirstError(JsonElement errors)
    {
        var first = errors[0];
        var message = first.TryGetProperty("message", out var m) ? m.GetString() ?? "(no message)" : "(no message)";

        string? code = null;
        if (first.TryGetProperty("extensions", out var ext)
            && ext.ValueKind == JsonValueKind.Object
            && ext.TryGetProperty("code", out var c))
            code = c.GetString();

        return (message, code);
    }

    /// <summary>
    /// Deserializes the <c>data</c> object, turning a shape mismatch into a categorized failure.
    /// </summary>
    /// <remarks>
    /// Letting <see cref="JsonException"/> escape made an unrecognized field shape surface as an
    /// unhandled HTTP 500 from whichever endpoint happened to trigger it — the caller could not fall
    /// back, could not report a reason, and the response body was a generic error. A malformed CTRM
    /// response is a CTRM read failure like any other, so it is reported as one.
    /// </remarks>
    private bool TryDeserialize<T>(JsonElement data, out T? value, out string error)
    {
        try
        {
            value = data.Deserialize<T>(JsonOptions);
            error = string.Empty;
            return true;
        }
        catch (JsonException ex)
        {
            value = default;
            // ex.Path names the offending field, which is the one detail that makes this diagnosable.
            error = $"CTRM returned a response this client could not map ({ex.Message})";
            _logger.LogError("CTRM response deserialization failed [{ErrorCode}] [{ErrorCategory}]: {JsonPath}",
                "INFRASTRUCTURE_CTRM_SHAPE", "Infrastructure", ex.Path ?? "(unknown path)");
            return false;
        }
    }

    /// <summary>An HTML body means the request never reached the API — the gateway answered.</summary>
    private static bool LooksLikeHtml(string body)
    {
        var trimmed = body.AsSpan().TrimStart();
        return trimmed.Length > 0 && trimmed[0] == '<';
    }

    private CtrmReadResult<T> Fail<T>(CtrmReadStatus status, int? httpStatus, string? errorCode, string detail)
    {
        // Outcome and status only — no contract, ticket or producer data in logs.
        _logger.LogWarning("CTRM read failed [{ErrorCode}] [{ErrorCategory}]: {Status} (HTTP {HttpStatus}, code {GraphQlCode})",
            "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", status, httpStatus, errorCode ?? "(none)");
        return new CtrmReadResult<T> { Status = status, HttpStatus = httpStatus, ErrorCode = errorCode, Detail = detail };
    }

    private async Task<string> GetBearerTokenAsync(CancellationToken cancellationToken)
    {
        if (_cachedToken.ExpiresOn > DateTimeOffset.UtcNow.AddMinutes(5))
            return _cachedToken.Token;

        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (_cachedToken.ExpiresOn <= DateTimeOffset.UtcNow.AddMinutes(5))
                _cachedToken = await _credential!.GetTokenAsync(new TokenRequestContext(_scopes), cancellationToken);
            return _cachedToken.Token;
        }
        finally
        {
            _tokenLock.Release();
        }
    }
}
