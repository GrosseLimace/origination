// System namespaces
using System.Net;
using System.Text;

// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Azure.Core;

// Project namespaces
using GrainOriginatorPortal.Api.Services.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The CTRM request id (<c>x-correlation-id</c>) being carried out of a failed read.
/// </summary>
/// <remarks>
/// CTRM answers an internal fault with HTTP 200, a GraphQL error, and the message "See App Insights via the
/// correlationId in the response headers" — so that header is the only handle the API team can trace. It was
/// not being read, which made those faults something we could see and they could not find; one occurred on
/// 2026-09-08 and could not be reported. These tests pin that the id survives to somewhere a human reads.
/// </remarks>
public class CtrmCorrelationIdTests
{
    private const string CorrelationId = "5f212be6-cf1d-43cc-b596-f93775ea0eef";
    private const string InternalErrorBody =
        """{"errors":[{"message":"An internal error occurred. See App Insights via the correlationId in the response headers."}]}""";

    private sealed class StubCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new("stub-token", DateTimeOffset.UtcNow.AddHours(1));

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new(GetToken(requestContext, cancellationToken));
    }

    private sealed class StubHandler(HttpStatusCode status, string body, string? correlationId) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
            if (correlationId is not null)
                response.Headers.TryAddWithoutValidation("x-correlation-id", correlationId);
            return Task.FromResult(response);
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) =>
            new(handler, disposeHandler: false) { BaseAddress = new Uri("https://ctrm.test/graphql") };
    }

    private static CtrmGraphQlClient Client(HttpStatusCode status, string body, string? correlationId)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ctrm:GraphQlUri"] = "https://ctrm.test/graphql",
                ["Ctrm:Audience"] = "api://ctrm/.default"
            })
            .Build();

        return new CtrmGraphQlClient(
            new StubCredential(),
            new StubFactory(new StubHandler(status, body, correlationId)),
            configuration,
            NullLogger<CtrmGraphQlClient>.Instance);
    }

    private sealed class Payload
    {
        public int Anything { get; set; }
    }

    [Fact]
    public async Task AnInternalCtrmFaultCarriesItsCorrelationIdOutOfTheFailedRead()
    {
        var result = await Client(HttpStatusCode.OK, InternalErrorBody, CorrelationId)
            .QueryAsync<Payload>("query { anything }", null, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(CtrmReadStatus.QueryError, result.Status);
        Assert.Contains(CorrelationId, result.Detail);
    }

    [Fact]
    public async Task TheOriginalCtrmMessageIsKeptAlongsideTheCorrelationId()
    {
        // The id alone is not enough to triage from our side — the failure text has to survive too.
        var result = await Client(HttpStatusCode.OK, InternalErrorBody, CorrelationId)
            .QueryAsync<Payload>("query { anything }", null, CancellationToken.None);

        Assert.Contains("An internal error occurred", result.Detail);
    }

    [Fact]
    public async Task AResponseWithoutTheHeaderStillFailsCleanly_WithNoPlaceholderPollutingTheDetail()
    {
        // Not every gateway hop sets the header, and a missing id must not turn into a literal "null" or an
        // empty bracket in something an operator reads. Asserted on the suffix this code appends rather than
        // on the word itself, because CTRM's own error text says "See App Insights via the correlationId".
        var result = await Client(HttpStatusCode.OK, InternalErrorBody, correlationId: null)
            .QueryAsync<Payload>("query { anything }", null, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(CtrmReadStatus.QueryError, result.Status);
        Assert.DoesNotContain("[CTRM correlationId", result.Detail);
        Assert.DoesNotContain("null]", result.Detail);
    }

    [Fact]
    public async Task AnUnauthorizedResponseAlsoCarriesTheCorrelationId()
    {
        // 401/403 comes from APIM rather than GraphQL, and it is the failure most likely to need someone
        // else to look it up on their side — so it must not be the path that loses the id.
        var result = await Client(HttpStatusCode.Unauthorized, """{"error":"denied"}""", CorrelationId)
            .QueryAsync<Payload>("query { anything }", null, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Unauthorized, result.Status);
        Assert.Contains(CorrelationId, result.Detail);
    }

    [Fact]
    public async Task AThrottledResponseAlsoCarriesTheCorrelationId()
    {
        var result = await Client(HttpStatusCode.TooManyRequests, """{"error":"slow down"}""", CorrelationId)
            .QueryAsync<Payload>("query { anything }", null, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Throttled, result.Status);
        Assert.Contains(CorrelationId, result.Detail);
    }

    [Fact]
    public async Task ASuccessfulReadIsUnaffectedByTheHeaderBeingPresent()
    {
        var result = await Client(HttpStatusCode.OK, """{"data":{"anything":7}}""", CorrelationId)
            .QueryAsync<Payload>("query { anything }", null, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(7, result.Value!.Anything);
    }
}
