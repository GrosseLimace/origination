// System namespaces
using System.Net;
using System.Text;

// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Azure.Core;
using Azure.Identity;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class GraphDirectoryClientTests
{
    private readonly StubHttpMessageHandler _handler = new();
    private readonly StubTokenCredential _credential = new();
    private readonly GraphDirectoryClient _sut;

    public GraphDirectoryClientTests()
    {
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("graph"))
            .Returns(() => new HttpClient(_handler) { BaseAddress = new Uri("https://graph.microsoft.com/v1.0/") });
        _sut = new GraphDirectoryClient(_credential, factory.Object, new Mock<ILogger<GraphDirectoryClient>>().Object);
    }

    // -------------------------------------------------------------------------
    // Outcome categorization — the spike's real deliverable
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, 403)]
    [InlineData(HttpStatusCode.Unauthorized, 401)]
    public async Task GraphRefusal_MapsToPermissionMissing_WithRawStatus(HttpStatusCode status, int expected)
    {
        _handler.Enqueue(status, "{}");

        var result = await _sut.GetGroupTransitiveUserMembersAsync("group-id", CancellationToken.None);

        Assert.Equal(GraphReadStatus.PermissionMissing, result.Status);
        Assert.Equal(expected, result.HttpStatus);
        Assert.Contains("GroupMember.Read.All", result.Detail);
    }

    [Fact]
    public async Task NotFoundResponse_MapsToNotFound()
    {
        _handler.Enqueue(HttpStatusCode.NotFound, "{}");

        var result = await _sut.GetGroupTransitiveUserMembersAsync("bad-id", CancellationToken.None);

        Assert.Equal(GraphReadStatus.NotFound, result.Status);
        Assert.Equal(404, result.HttpStatus);
    }

    [Fact]
    public async Task NetworkFailure_MapsToEgressBlocked_WithNsgHint()
    {
        _handler.ThrowOnSend = new HttpRequestException("connection refused");

        var result = await _sut.GetGroupTransitiveUserMembersAsync("group-id", CancellationToken.None);

        Assert.Equal(GraphReadStatus.EgressBlocked, result.Status);
        Assert.Null(result.HttpStatus);
        Assert.Contains("outbound rule", result.Detail);
    }

    [Fact]
    public async Task Timeout_MapsToEgressBlocked_WhenCallerDidNotCancel()
    {
        // HttpClient timeouts surface as TaskCanceledException while the caller's token is still live.
        _handler.ThrowOnSend = new TaskCanceledException("timed out");

        var result = await _sut.GetGroupTransitiveUserMembersAsync("group-id", CancellationToken.None);

        Assert.Equal(GraphReadStatus.EgressBlocked, result.Status);
    }

    [Fact]
    public async Task CredentialFailure_MapsToTokenFailure_AndSendsNoHttpRequest()
    {
        _credential.ThrowOnGetToken = new CredentialUnavailableException("no credential source");

        var result = await _sut.GetGroupTransitiveUserMembersAsync("group-id", CancellationToken.None);

        Assert.Equal(GraphReadStatus.TokenFailure, result.Status);
        Assert.Empty(_handler.RequestUris); // failed before any HTTP
    }

    [Fact]
    public async Task UnexpectedStatus_MapsToError_WithRawStatus()
    {
        _handler.Enqueue((HttpStatusCode)429, "{}");

        var result = await _sut.GetGroupTransitiveUserMembersAsync("group-id", CancellationToken.None);

        Assert.Equal(GraphReadStatus.Error, result.Status);
        Assert.Equal(429, result.HttpStatus);
    }

    // -------------------------------------------------------------------------
    // Happy path: paging, member shape
    // -------------------------------------------------------------------------

    [Fact]
    public async Task TransitiveMembers_MergesPagesAcrossNextLink()
    {
        _handler.Enqueue(HttpStatusCode.OK, """
            {
              "value": [ { "id": "1", "displayName": "Ann A", "userPrincipalName": "AnnA@scoular.com", "accountEnabled": true } ],
              "@odata.nextLink": "https://graph.microsoft.com/v1.0/groups/g/transitiveMembers/microsoft.graph.user?$skiptoken=page2"
            }
            """);
        _handler.Enqueue(HttpStatusCode.OK, """
            {
              "value": [
                { "id": "2", "displayName": "Bob B", "userPrincipalName": "BobB@scoular.com", "accountEnabled": false },
                { "id": "3", "displayName": "Cal C", "userPrincipalName": "CalC@scoular.com", "accountEnabled": null }
              ]
            }
            """);

        var result = await _sut.GetGroupTransitiveUserMembersAsync("g", CancellationToken.None);

        Assert.Equal(GraphReadStatus.Ok, result.Status);
        Assert.Equal(3, result.Value!.Count);
        Assert.Equal(2, _handler.RequestUris.Count);
        Assert.Contains("$skiptoken=page2", _handler.RequestUris[1]);
        Assert.True(result.Value[0].AccountEnabled);
        Assert.False(result.Value[1].AccountEnabled);
        Assert.Null(result.Value[2].AccountEnabled); // null accountEnabled survives, not coerced
    }

    // -------------------------------------------------------------------------
    // Group-by-name resolution
    // -------------------------------------------------------------------------

    [Fact]
    public async Task FindGroupByName_ReturnsFirstMatch()
    {
        _handler.Enqueue(HttpStatusCode.OK, """{ "value": [ { "id": "abc-123", "displayName": "Origination App Dev Users" } ] }""");

        var result = await _sut.FindGroupByNameAsync("Origination App Dev Users", CancellationToken.None);

        Assert.Equal(GraphReadStatus.Ok, result.Status);
        Assert.Equal("abc-123", result.Value!.Id);
    }

    [Fact]
    public async Task FindGroupByName_EmptyResult_MapsToNotFound_NamingTheGroup()
    {
        _handler.Enqueue(HttpStatusCode.OK, """{ "value": [] }""");

        var result = await _sut.FindGroupByNameAsync("No Such Group", CancellationToken.None);

        Assert.Equal(GraphReadStatus.NotFound, result.Status);
        Assert.Contains("No Such Group", result.Detail);
    }

    [Fact]
    public async Task FindGroupByName_EscapesSingleQuotes_InEncodedFilter()
    {
        _handler.Enqueue(HttpStatusCode.OK, """{ "value": [] }""");

        await _sut.FindGroupByNameAsync("O'Brien Group", CancellationToken.None);

        // ' doubles to '' per OData, then percent-encodes to %27%27
        Assert.Contains("O%27%27Brien", _handler.RequestUris[0]);
    }

    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("O'Brien", "O''Brien")]
    [InlineData("a''b", "a''''b")]
    public void EscapeODataLiteral_DoublesSingleQuotes(string input, string expected)
    {
        Assert.Equal(expected, GraphDirectoryClient.EscapeODataLiteral(input));
    }

    // -------------------------------------------------------------------------
    // Token caching
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Token_IsCachedAcrossCalls_UntilNearExpiry()
    {
        _handler.Enqueue(HttpStatusCode.OK, """{ "value": [] }""");
        _handler.Enqueue(HttpStatusCode.OK, """{ "value": [] }""");

        await _sut.GetGroupTransitiveUserMembersAsync("g", CancellationToken.None);
        await _sut.GetGroupTransitiveUserMembersAsync("g", CancellationToken.None);

        Assert.Equal(1, _credential.GetTokenCalls);
    }

    [Fact]
    public async Task Token_IsReacquired_WhenNearExpiry()
    {
        _credential.ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(1); // inside the 5-minute refresh window
        _handler.Enqueue(HttpStatusCode.OK, """{ "value": [] }""");
        _handler.Enqueue(HttpStatusCode.OK, """{ "value": [] }""");

        await _sut.GetGroupTransitiveUserMembersAsync("g", CancellationToken.None);
        await _sut.GetGroupTransitiveUserMembersAsync("g", CancellationToken.None);

        Assert.Equal(2, _credential.GetTokenCalls);
    }

    // -------------------------------------------------------------------------
    // Test doubles
    // -------------------------------------------------------------------------

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responses = new();
        public List<string> RequestUris { get; } = [];
        public Exception? ThrowOnSend { get; set; }

        public void Enqueue(HttpStatusCode status, string json) =>
            _responses.Enqueue(_ => new HttpResponseMessage(status)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUris.Add(request.RequestUri!.ToString());
            if (ThrowOnSend is not null)
                throw ThrowOnSend;
            if (_responses.Count == 0)
                throw new InvalidOperationException("No stubbed response queued for " + request.RequestUri);
            return Task.FromResult(_responses.Dequeue()(request));
        }
    }

    private sealed class StubTokenCredential : TokenCredential
    {
        public int GetTokenCalls;
        public Exception? ThrowOnGetToken { get; set; }
        public DateTimeOffset ExpiresOn { get; set; } = DateTimeOffset.UtcNow.AddHours(1);

        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            GetTokenCalls++;
            if (ThrowOnGetToken is not null)
                throw ThrowOnGetToken;
            return new AccessToken("stub-token", ExpiresOn);
        }

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new(GetToken(requestContext, cancellationToken));
    }
}
