// System namespaces
using System.Net;
using System.Text;
using System.Text.Json;

// Microsoft namespaces
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

// Third-party namespaces
using Azure.Core;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services.DocStore;

namespace GrainOriginatorPortal.Api.Tests.Services.DocStore;

/// <summary>
/// The Doc Store HTTP client against a fake gateway: the request shape Doc Store's API-USAGE-GUIDE.md asks
/// for (JSON with base64 content and the category code, a bearer token for the configured scope), and how
/// its answers turn into Origination errors.
/// </summary>
public class HttpDocStoreClientTests
{
    private const string Scope = "api://f9577a19-eac4-45f8-997d-e956d6154430/.default";

    private sealed class Gateway(Func<HttpRequestMessage, string?, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string? Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            Calls.Add((request, body));
            return answer(request, body);
        }
    }

    private sealed class FixedToken : TokenCredential
    {
        public List<string[]> Asked { get; } = [];
        public override AccessToken GetToken(TokenRequestContext context, CancellationToken ct) => Issue(context);
        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext context, CancellationToken ct) => new(Issue(context));
        private AccessToken Issue(TokenRequestContext context)
        {
            Asked.Add(context.Scopes);
            return new AccessToken("token-123", DateTimeOffset.UtcNow.AddHours(1));
        }
    }

    private static (HttpDocStoreClient Client, Gateway Gateway, FixedToken Token) New(Func<HttpRequestMessage, string?, HttpResponseMessage> answer)
    {
        var gateway = new Gateway(answer);
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(HttpDocStoreClient.HttpClientName))
            .Returns(() => new HttpClient(gateway, disposeHandler: false) { BaseAddress = new Uri("https://apiqa.scoular.com/internal/docstore/v1/") });
        var token = new FixedToken();
        var client = new HttpDocStoreClient(token, factory.Object,
            Options.Create(new DocStoreOptions { BaseUrl = "https://apiqa.scoular.com/internal/docstore/v1", Scope = Scope }),
            NullLogger<HttpDocStoreClient>.Instance);
        return (client, gateway, token);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static DocStoreUpload Upload() =>
        new("report.pdf", "application/pdf", Encoding.ASCII.GetBytes("%PDF-1.7"), new Dictionary<string, string> { ["splitId"] = "TATOB43" });

    [Fact]
    public async Task Upload_PostsJsonWithBase64ContentAndTheCategoryCode_AsTheConfiguredScope()
    {
        var id = Guid.NewGuid();
        var (client, gateway, token) = New((_, _) => Json(HttpStatusCode.Created,
            $$"""{"documentId":"{{id}}","fileName":"report.pdf","contentType":"application/pdf","fileSizeBytes":8,"createdDate":"2026-11-05T15:00:00Z"}"""));

        var doc = await client.UploadAsync(Upload(), default);

        Assert.Equal(id.ToString(), doc.Id);
        Assert.Equal(8, doc.Size);
        var (request, body) = Assert.Single(gateway.Calls);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://apiqa.scoular.com/internal/docstore/v1/documents", request.RequestUri!.ToString());
        Assert.Equal("Bearer token-123", request.Headers.Authorization!.ToString());
        Assert.Equal([Scope], Assert.Single(token.Asked));
        var json = JsonDocument.Parse(body!).RootElement;
        Assert.Equal("Sustainability-45z", json.GetProperty("categoryCode").GetString());
        Assert.Equal(Convert.ToBase64String(Encoding.ASCII.GetBytes("%PDF-1.7")), json.GetProperty("fileContent").GetString());
        Assert.Equal("TATOB43", json.GetProperty("metadata").GetProperty("splitId").GetString());
    }

    [Fact]
    public async Task Upload_ARefusedFile_IsAValidationErrorWithDocStoresReason()
    {
        var (client, _, _) = New((_, _) => Json(HttpStatusCode.BadRequest, "\"File type not allowed for this category.\""));

        var ex = await Assert.ThrowsAsync<ValidationException>(() => client.UploadAsync(Upload(), default));

        Assert.Contains("File type not allowed for this category.", ex.Errors["file"][0]);
    }

    [Fact]
    public async Task Upload_AFileTypeTheCategoryDoesntTake_IsOnePlainSentence()
    {
        // Doc Store's own message, as seen on Dev 2026-11-05 (it goes on to list every allowed MIME type).
        var (client, _, _) = New((_, _) => Json(HttpStatusCode.BadRequest,
            "\"Content type 'image/png' is not allowed for category 'Sustainability-45z'. Allowed types: application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/tiff\""));

        var ex = await Assert.ThrowsAsync<ValidationException>(() => client.UploadAsync(Upload(), default));

        Assert.Equal("Doc Store isn't set up to take PNG files for 45Z documents yet. Upload a PDF, or ask IT to allow PNG for the Sustainability-45z category.", ex.Errors["file"][0]);
    }

    [Fact]
    public async Task Upload_NoAccessToTheCategory_IsA502ThatNamesTheCategory()
    {
        var (client, _, _) = New((_, _) => new HttpResponseMessage(HttpStatusCode.Forbidden));

        var ex = await Assert.ThrowsAsync<InfrastructureException>(() => client.UploadAsync(Upload(), default));

        Assert.Equal(502, ex.HttpStatusCode);
        Assert.Contains("Sustainability-45z", ex.Message);
    }

    [Fact]
    public async Task Download_AsksForTheProxiedContent_AndAMissingDocumentIsNull()
    {
        var id = Guid.NewGuid();
        var (client, gateway, _) = New((request, _) => request.RequestUri!.AbsolutePath.Contains(id.ToString())
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Encoding.ASCII.GetBytes("%PDF-1.7")) }
            : new HttpResponseMessage(HttpStatusCode.NotFound));

        var content = await client.DownloadAsync(id.ToString(), default);

        Assert.NotNull(content);
        Assert.Equal($"https://apiqa.scoular.com/internal/docstore/v1/documents/{id}/content?deliveryMethod=proxy", gateway.Calls[0].Request.RequestUri!.ToString());
        Assert.Null(await client.DownloadAsync(Guid.NewGuid().ToString(), default));
        Assert.Null(await client.DownloadAsync("../not-a-guid", default));
        Assert.Equal(2, gateway.Calls.Count);
    }

    [Theory]
    [InlineData("\"Too big.\"", "Too big.")]
    [InlineData("{\"error\":\"Category code 'x' not found.\"}", "Category code 'x' not found.")]
    [InlineData("{\"error\":{\"code\":\"FileTooLarge\",\"message\":\"Over 100 MB.\"}}", "Over 100 MB.")]
    [InlineData("{\"errors\":[\"fileName is required\",\"contentType is required\"]}", "fileName is required contentType is required")]
    [InlineData("File size exceeds maximum allowed size of 100 MB.", "File size exceeds maximum allowed size of 100 MB.")]
    public void Reason_ReadsEachShapeDocStoreAnswersWith(string body, string reason) =>
        Assert.Equal(reason, HttpDocStoreClient.Reason(body));
}
