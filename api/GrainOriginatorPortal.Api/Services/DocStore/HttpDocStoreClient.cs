using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Azure.Core;
using Azure.Identity;
using GrainOriginatorPortal.Api.Exceptions;
using Microsoft.Extensions.Options;

namespace GrainOriginatorPortal.Api.Services.DocStore;

/// <summary>
/// The real Doc Store, through APIM (Doc Store's docs/API-USAGE-GUIDE.md): <c>POST documents</c> with the
/// file base64-encoded in JSON and the category code, and <c>GET documents/{id}/content?deliveryMethod=proxy</c>
/// to stream it back. Tokens are for <see cref="DocStoreOptions.Scope"/>: the App Service's managed identity
/// in Azure (Jesse and Charlie granted it the category in Dev and QA), the developer's <c>az login</c> on a
/// laptop. Uploads aren't retried: Doc Store doesn't reject a duplicate, so a retry after a timeout could file
/// the same document twice.
/// </summary>
public sealed class HttpDocStoreClient : IDocStoreClient
{
    /// <summary>Named client registered in Program.cs; BaseAddress is <see cref="DocStoreOptions.BaseUrl"/>.</summary>
    public const string HttpClientName = "docstore";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly TokenCredential _credential;
    private readonly IHttpClientFactory _httpFactory;
    private readonly DocStoreOptions _options;
    private readonly ILogger<HttpDocStoreClient> _logger;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private AccessToken _cachedToken;

    public HttpDocStoreClient(TokenCredential credential, IHttpClientFactory httpFactory, IOptions<DocStoreOptions> options,
        ILogger<HttpDocStoreClient> logger)
    {
        _credential = credential;
        _httpFactory = httpFactory;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>The managed identity on App Service; the developer's own Azure CLI sign-in anywhere else.</summary>
    public static TokenCredential CreateCredential(bool isAppService) =>
        isAppService ? new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned) : new AzureCliCredential();

    public async Task<DocStoreDocument> UploadAsync(DocStoreUpload upload, CancellationToken ct)
    {
        var body = new
        {
            fileContent = Convert.ToBase64String(upload.Content),
            fileName = upload.FileName,
            contentType = upload.ContentType,
            categoryCode = _options.Category,
            metadata = upload.Metadata,
        };
        using var request = new HttpRequestMessage(HttpMethod.Post, "documents") { Content = JsonContent.Create(body, options: Json) };
        using var response = await SendAsync(request, "upload", ct);
        if (!response.IsSuccessStatusCode)
            throw await FailureAsync(response, "upload", ct);

        var stored = await response.Content.ReadFromJsonAsync<StoredDocument>(Json, ct);
        if (stored is null || stored.DocumentId == Guid.Empty)
            throw new InfrastructureException("Doc Store didn't say which document it saved.", "DOC_STORE_BAD_RESPONSE", StatusCodes.Status502BadGateway);
        return new DocStoreDocument(stored.DocumentId.ToString(), stored.FileName ?? upload.FileName, stored.ContentType ?? upload.ContentType,
            stored.FileSizeBytes > 0 ? stored.FileSizeBytes : upload.Content.LongLength,
            stored.CreatedDate == default ? DateTime.UtcNow : DateTime.SpecifyKind(stored.CreatedDate, DateTimeKind.Utc));
    }

    public async Task<DocStoreContent?> DownloadAsync(string documentId, CancellationToken ct)
    {
        if (!Guid.TryParse(documentId, out var id)) return null;
        using var request = new HttpRequestMessage(HttpMethod.Get, $"documents/{id}/content?deliveryMethod=proxy");
        using var response = await SendAsync(request, "download", ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        if (!response.IsSuccessStatusCode)
            throw await FailureAsync(response, "download", ct);

        // Buffered (files are at most MaxFileBytes) so the response can be disposed here.
        var buffer = new MemoryStream();
        await response.Content.CopyToAsync(buffer, ct);
        buffer.Position = 0;
        var contentType = response.Content.Headers.ContentType?.MediaType ?? "application/octet-stream";
        var fileName = response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"')
            ?? "document";
        return new DocStoreContent(buffer, contentType, fileName);
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, string action, CancellationToken ct)
    {
        try
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await TokenAsync(ct));
            return await _httpFactory.CreateClient(HttpClientName).SendAsync(request, ct);
        }
        catch (Exception ex) when (ex is CredentialUnavailableException or AuthenticationFailedException)
        {
            _logger.LogError("Doc Store token failed on {Action} [{ErrorCode}] [{ErrorCategory}]: {ExceptionType}",
                action, "INFRASTRUCTURE_DOC_STORE_TOKEN", "Infrastructure", ex.GetType().Name);
            throw new InfrastructureException("Origination couldn't sign in to Doc Store.", "DOC_STORE_TOKEN", ex);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            _logger.LogError("Doc Store unreachable on {Action} [{ErrorCode}] [{ErrorCategory}]: {ExceptionType}",
                action, "INFRASTRUCTURE_DOC_STORE_UNREACHABLE", "Infrastructure", ex.GetType().Name);
            throw new InfrastructureException("Doc Store couldn't be reached. Try again in a minute.", "DOC_STORE_UNREACHABLE", ex);
        }
    }

    /// <summary>
    /// A refused file (400, 413, 415) is the user's to fix and keeps Doc Store's reason; anything else is
    /// Doc Store's or the setup's, logged with the status and shown as a plain failure.
    /// </summary>
    private async Task<Exception> FailureAsync(HttpResponseMessage response, string action, CancellationToken ct)
    {
        var status = (int)response.StatusCode;
        var detail = await response.Content.ReadAsStringAsync(ct);
        if (detail.Length > 500) detail = detail[..500];
        _logger.LogWarning("Doc Store {Action} failed [{ErrorCode}] [{ErrorCategory}]: Status={Status}, Detail={Detail}",
            action, "INFRASTRUCTURE_DOC_STORE_" + status, "Infrastructure", status, detail);

        return response.StatusCode switch
        {
            HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge or HttpStatusCode.UnsupportedMediaType =>
                new ValidationException("file", Refusal(Reason(detail), _options.Category)),
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                new InfrastructureException($"Doc Store refused Origination's access to the {_options.Category} category.",
                    "DOC_STORE_FORBIDDEN", StatusCodes.Status502BadGateway),
            HttpStatusCode.TooManyRequests =>
                new InfrastructureException("Doc Store is busy. Try again in a minute.", "DOC_STORE_THROTTLED"),
            _ => new InfrastructureException("Doc Store had a problem. Try again in a minute.", "DOC_STORE_FAILED",
                StatusCodes.Status502BadGateway),
        };
    }

    /// <summary>
    /// What the originator reads. A file type the category doesn't take gets one plain sentence (Doc Store's own
    /// message lists every allowed MIME type, which doesn't fit a toast); anything else keeps Doc Store's reason.
    /// </summary>
    internal static string Refusal(string reason, string category)
    {
        var match = Regex.Match(reason, @"Content type '(?<type>[^']+)' is not allowed for category");
        if (!match.Success) return ("Doc Store refused the file. " + reason).Trim();
        var kind = match.Groups["type"].Value switch
        {
            "application/pdf" => "PDF",
            "image/png" => "PNG",
            "image/jpeg" or "image/jpg" => "JPEG",
            var other => other,
        };
        return $"Doc Store isn't set up to take {kind} files for 45Z documents yet. Upload a PDF, or ask IT to allow {kind} for the {category} category.";
    }

    /// <summary>Doc Store answers a refusal as plain text, <c>{ "error": "…" }</c> or <c>{ "errors": [ … ] }</c>.</summary>
    internal static string Reason(string detail)
    {
        try
        {
            using var doc = JsonDocument.Parse(detail);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.String) return root.GetString() ?? "";
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("error", out var error))
                return error.ValueKind == JsonValueKind.String ? error.GetString() ?? ""
                    : error.ValueKind == JsonValueKind.Object && error.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array)
                return string.Join(" ", errors.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()));
            return "";
        }
        catch (JsonException)
        {
            return detail.Trim();
        }
    }

    private async Task<string> TokenAsync(CancellationToken ct)
    {
        if (_cachedToken.ExpiresOn > DateTimeOffset.UtcNow.AddMinutes(5)) return _cachedToken.Token;
        await _tokenLock.WaitAsync(ct);
        try
        {
            if (_cachedToken.ExpiresOn <= DateTimeOffset.UtcNow.AddMinutes(5))
                _cachedToken = await _credential.GetTokenAsync(new TokenRequestContext([_options.Scope]), ct);
            return _cachedToken.Token;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    private sealed record StoredDocument(Guid DocumentId, string? FileName, string? ContentType, long FileSizeBytes, DateTime CreatedDate);
}
