// System namespaces
using System.Net;
using System.Text;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Pins the shared Nominatim loop behind elevator-cache/refresh?geocode=true and the background
/// elevator-cache/geocode job, now in <see cref="ElevatorCacheDiagnosticsService"/>: the named
/// "nominatim" client, the free-text <c>q=</c> query, and the DOCUMENTED per-item swallow-and-count
/// (one bad address must not abort the walk). Each HTTP item costs the loop's own 1.1s pacing, so
/// the cases stay small. The periodic checkpoint (saveEvery) needs a real DbContext and is not covered.
/// </summary>
public class ElevatorCacheGeocodeLoopTests
{
    private readonly StubHttpMessageHandler _handler = new();
    private readonly Mock<IHttpClientFactory> _factory = new();
    private readonly CapturingLogger<ElevatorCacheDiagnosticsService> _logger = new();
    // Provider-less: never touched when saveEvery is null.
    private readonly ApplicationDbContext _appContext = new(new DbContextOptionsBuilder<ApplicationDbContext>().Options);

    public ElevatorCacheGeocodeLoopTests()
    {
        _factory.Setup(f => f.CreateClient("nominatim"))
            .Returns(() => new HttpClient(_handler) { BaseAddress = new Uri("https://nominatim.openstreetmap.org/") });
    }

    private Task<(int Geocoded, int Failed)> Run(params ElevatorCache[] elevators) =>
        ElevatorCacheDiagnosticsService.GeocodeElevatorsAsync(
            elevators.ToList(), _factory.Object, _logger, saveEvery: null, _appContext, CancellationToken.None);

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Success_WritesCoordinates_NonSuccessAndThrow_CountAsFailed_AndTheWalkContinues()
    {
        _handler.Enqueue(HttpStatusCode.OK, """[{"lat":"41.2565","lon":"-95.9345"}]""");
        _handler.Enqueue(HttpStatusCode.ServiceUnavailable, "");
        _handler.EnqueueThrow(new HttpRequestException("circuit open"));
        _handler.Enqueue(HttpStatusCode.OK, "[]");
        var ok = new ElevatorCache { ElevatorCode = "E1", Address = "123 Main", City = "Omaha", State = "NE" };
        var unavailable = new ElevatorCache { ElevatorCode = "E2", City = "Lincoln", State = "NE" };
        var thrown = new ElevatorCache { ElevatorCode = "E3", City = "Kearney", State = "NE" };
        var noMatch = new ElevatorCache { ElevatorCode = "E4", City = "Nowhere", State = "NE" };

        var (geocoded, failed) = await Run(ok, unavailable, thrown, noMatch);

        Assert.Equal(1, geocoded);
        Assert.Equal(3, failed);
        Assert.Equal(41.2565, ok.Latitude);
        Assert.Equal(-95.9345, ok.Longitude);
        Assert.Null(unavailable.Latitude);
        Assert.Null(thrown.Latitude);
        Assert.Null(noMatch.Latitude);
        Assert.Equal(4, _handler.RequestUris.Count); // the walk did not stop at the failure

        // Only the thrown item logs, and it names the elevator code, never the address.
        var warning = Assert.Single(_logger.Entries);
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.Equal("Geocoding failed for E3", warning.Message);
        Assert.Equal("E3", warning.Fields["Code"]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UsesTheNamedNominatimClient_WithTheFreeTextQuery()
    {
        _handler.Enqueue(HttpStatusCode.OK, "[]");

        await Run(new ElevatorCache { ElevatorCode = "E1", Address = " 123 Main ", City = "Omaha", State = "NE" });

        _factory.Verify(f => f.CreateClient("nominatim"), Times.Once);
        var uri = Assert.Single(_handler.RequestUris);
        Assert.Equal("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=123%20Main%2C%20Omaha%2C%20NE", uri);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ElevatorWithNoAddressParts_CountsAsFailed_WithoutAnHttpCall()
    {
        var (geocoded, failed) = await Run(new ElevatorCache { ElevatorCode = "E1", Address = "  ", City = null, State = null });

        Assert.Equal(0, geocoded);
        Assert.Equal(1, failed);
        Assert.Empty(_handler.RequestUris);
        Assert.Empty(_logger.Entries);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AlreadyCancelled_StopsBeforeTheFirstItem()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var (geocoded, failed) = await ElevatorCacheDiagnosticsService.GeocodeElevatorsAsync(
            [new ElevatorCache { ElevatorCode = "E1", City = "Omaha", State = "NE" }],
            _factory.Object, _logger, saveEvery: null, _appContext, cts.Token);

        Assert.Equal((0, 0), (geocoded, failed));
        Assert.Empty(_handler.RequestUris);
    }

    // -------------------------------------------------------------------------
    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responses = new();
        public List<string> RequestUris { get; } = [];

        public void Enqueue(HttpStatusCode status, string json) =>
            _responses.Enqueue(_ => new HttpResponseMessage(status)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });

        public void EnqueueThrow(Exception ex) => _responses.Enqueue(_ => throw ex);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUris.Add(request.RequestUri!.AbsoluteUri);
            if (_responses.Count == 0)
                throw new InvalidOperationException("No stubbed response queued for " + request.RequestUri);
            return Task.FromResult(_responses.Dequeue()(request));
        }
    }
}
