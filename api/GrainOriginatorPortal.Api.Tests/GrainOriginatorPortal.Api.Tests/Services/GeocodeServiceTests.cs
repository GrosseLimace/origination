// System namespaces
using System.Diagnostics;
using System.Net;
using System.Text;

// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// GeocodeService is a singleton fronting Nominatim, which blocks the whole App Service IP if we
/// exceed 1 req/sec. These tests pin the three things that keep us off that list: the shared
/// pacing limiter, the positive AND negative cache, and the degrade-to-key-only failure handling.
/// They also pin the M-014 rule that no address text reaches the logs.
/// </summary>
public class GeocodeServiceTests
{
    private const string OmahaJson = """[{"lat":"41.2565","lon":"-95.9345","display_name":"Omaha, NE"}]""";
    private const string LincolnJson = """[{"lat":"40.8136","lon":"-96.7026","display_name":"Lincoln, NE"}]""";

    private readonly StubHttpMessageHandler _handler = new();
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 100 });
    private readonly Mock<ILogger<GeocodeService>> _loggerMock = new();
    private readonly GeocodeService _sut;

    public GeocodeServiceTests()
    {
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("nominatim"))
            .Returns(() => new HttpClient(_handler) { BaseAddress = new Uri("https://nominatim.openstreetmap.org/") });
        _sut = new GeocodeService(factory.Object, _loggerMock.Object, _cache);
    }

    private static GeocodeRequest Omaha(string key = "cust-1") =>
        new() { Key = key, City = "Omaha", State = "NE", Zip = "68102" };

    private static GeocodeRequest Lincoln(string key = "cust-2") =>
        new() { Key = key, City = "Lincoln", State = "NE", Zip = "68508" };

    // -------------------------------------------------------------------------
    // GeocodeSingleAsync
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GeocodeSingleAsync_WhenRequestIsNull_ReturnsEmptyResultWithoutCallingNominatim()
    {
        var result = await _sut.GeocodeSingleAsync(null, CancellationToken.None);

        Assert.Equal(string.Empty, result.Key);
        Assert.Null(result.Lat);
        Assert.Null(result.Lng);
        Assert.Empty(_handler.RequestUris);
    }

    [Fact]
    public async Task GeocodeSingleAsync_OnSuccess_ReturnsCoordinatesAndServesTheRepeatFromCache()
    {
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);

        var first = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);
        var second = await _sut.GeocodeSingleAsync(Omaha("other-key"), CancellationToken.None);

        Assert.Equal("cust-1", first.Key);
        Assert.Equal(41.2565, first.Lat);
        Assert.Equal(-95.9345, first.Lng);
        // Same address under a different caller key is the same cache entry; the key is echoed back.
        Assert.Equal("other-key", second.Key);
        Assert.Equal(41.2565, second.Lat);
        Assert.Single(_handler.RequestUris);

        var url = _handler.RequestUris[0];
        Assert.Contains("country=US", url);
        Assert.Contains("format=json", url);
        Assert.Contains("limit=1", url);
        Assert.Contains("city=Omaha", url);
        Assert.Contains("state=NE", url);
        Assert.Contains("postalcode=68102", url);
        Assert.DoesNotContain("street=", url); // blank street is omitted, not sent as empty
    }

    [Fact]
    public async Task GeocodeSingleAsync_IncludesTheStreet_AndCacheKeyIgnoresItsCaseAndPadding()
    {
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);
        var exact = new GeocodeRequest { Key = "a", Street = "123 Main St", City = "Omaha", State = "NE", Zip = "68102" };
        var sloppy = new GeocodeRequest { Key = "b", Street = "  123 MAIN ST ", City = "Omaha", State = "NE", Zip = "68102" };

        await _sut.GeocodeSingleAsync(exact, CancellationToken.None);
        var repeat = await _sut.GeocodeSingleAsync(sloppy, CancellationToken.None);

        Assert.Single(_handler.RequestUris);
        Assert.Contains("street=123%20Main%20St", _handler.RequestUris[0]);
        Assert.Equal(41.2565, repeat.Lat);
    }

    // A "no match" from Nominatim is cached as a miss so the same bad address is not re-queried on
    // every map load. That would burn the 1 req/sec budget on addresses that can never resolve.
    [Fact]
    public async Task GeocodeSingleAsync_WhenNominatimFindsNothing_CachesTheMissAndDoesNotRetry()
    {
        _handler.Enqueue(HttpStatusCode.OK, "[]");

        var first = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);
        var second = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);

        Assert.Equal("cust-1", first.Key);
        Assert.Null(first.Lat);
        Assert.Null(second.Lat);
        Assert.Single(_handler.RequestUris);
    }

    // A 429 is transient: degrade to key-only for this call, log it, but do NOT cache the failure.
    // The next call must be allowed to try again.
    [Fact]
    public async Task GeocodeSingleAsync_WhenRateLimited_ReturnsKeyOnlyLogsItAndDoesNotCache()
    {
        _handler.Enqueue(HttpStatusCode.TooManyRequests, "{}");
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);

        var limited = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);
        var retried = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);

        Assert.Equal("cust-1", limited.Key);
        Assert.Null(limited.Lat);
        Assert.Equal(41.2565, retried.Lat);
        Assert.Equal(2, _handler.RequestUris.Count);
        VerifyLoggedErrorWithoutAddress("INFRASTRUCTURE_GEOCODE_RATE_LIMITED");
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task GeocodeSingleAsync_WhenNominatimReturnsAnError_ReturnsKeyOnlyAndDoesNotThrow(HttpStatusCode status)
    {
        _handler.Enqueue(status, "{}");

        var result = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);

        Assert.Equal("cust-1", result.Key);
        Assert.Null(result.Lat);
        Assert.Null(result.Lng);
        VerifyLoggedErrorWithoutAddress("INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
    }

    [Fact]
    public async Task GeocodeSingleAsync_WhenTheNetworkFails_ReturnsKeyOnly()
    {
        _handler.EnqueueThrow(new HttpRequestException("connection refused"));

        var result = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);

        Assert.Equal("cust-1", result.Key);
        Assert.Null(result.Lat);
        VerifyLoggedErrorWithoutAddress("INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
    }

    // HttpClient timeouts surface as TaskCanceledException while the caller token is still live.
    // That is an infrastructure timeout, not a caller cancellation, and must be swallowed as such.
    [Fact]
    public async Task GeocodeSingleAsync_WhenTheRequestTimesOut_ReturnsKeyOnly()
    {
        _handler.EnqueueThrow(new TaskCanceledException("timed out"));

        var result = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);

        Assert.Equal("cust-1", result.Key);
        Assert.Null(result.Lat);
        VerifyLoggedErrorWithoutAddress("INFRASTRUCTURE_TIMEOUT");
    }

    // A genuine caller cancellation must propagate, and (because the service is a singleton) must
    // leave the shared limiter usable for the next request.
    [Fact]
    public async Task GeocodeSingleAsync_WhenTheCallerCancels_PropagatesAndLeavesTheLimiterUsable()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => _sut.GeocodeSingleAsync(Omaha(), cts.Token));

        Assert.Empty(_handler.RequestUris);
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);
        var next = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);
        Assert.Equal(41.2565, next.Lat);
    }

    // The contract with Nominatim: never more than one request per second from this process.
    [Fact]
    public async Task GeocodeSingleAsync_PacesConsecutiveNominatimCallsAtLeastOneSecondApart()
    {
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);
        _handler.Enqueue(HttpStatusCode.OK, LincolnJson);

        await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);
        await _sut.GeocodeSingleAsync(Lincoln(), CancellationToken.None);

        Assert.Equal(2, _handler.RequestTimestampsMs.Count);
        var gap = _handler.RequestTimestampsMs[1] - _handler.RequestTimestampsMs[0];
        Assert.True(gap >= 1000, $"Expected >= 1000ms between Nominatim calls, got {gap}ms.");
    }

    // -------------------------------------------------------------------------
    // GeocodeBatchAsync
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GeocodeBatchAsync_WhenRequestsAreNullOrEmpty_ReturnsEmptyWithoutCallingNominatim()
    {
        var fromNull = await _sut.GeocodeBatchAsync(null, CancellationToken.None);
        var fromEmpty = await _sut.GeocodeBatchAsync([], CancellationToken.None);

        Assert.Empty(fromNull);
        Assert.Empty(fromEmpty);
        Assert.Empty(_handler.RequestUris);
    }

    [Fact]
    public async Task GeocodeBatchAsync_ServesCachedItemsWithoutCallingNominatim_AndKeepsRequestOrder()
    {
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);
        await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None); // primes the cache
        _handler.Enqueue(HttpStatusCode.OK, LincolnJson);

        var results = await _sut.GeocodeBatchAsync([Omaha("first"), Lincoln("second")], CancellationToken.None);

        Assert.Equal(["first", "second"], results.Select(r => r.Key));
        Assert.Equal(41.2565, results[0].Lat);
        Assert.Equal(40.8136, results[1].Lat);
        Assert.Equal(2, _handler.RequestUris.Count); // one for the prime, one for Lincoln; none for the cached Omaha
    }

    // Abuse cap: 50 items max per batch. The 51 entries are pre-seeded in the cache (using the
    // service's "city,state,zip" lower-cased key shape) so the test exercises the cap, not 50
    // seconds of pacing delay.
    [Fact]
    public async Task GeocodeBatchAsync_CapsTheBatchAtFiftyRequests()
    {
        var requests = Enumerable.Range(1, 51)
            .Select(i => new GeocodeRequest { Key = $"k{i}", City = $"City{i}", State = "NE", Zip = "00000" })
            .ToList();
        foreach (var r in requests)
            _cache.Set<double[]?>($"{r.City!.ToLower()},ne,00000", [1.0, 2.0], new MemoryCacheEntryOptions { Size = 1 });

        var results = await _sut.GeocodeBatchAsync(requests, CancellationToken.None);

        Assert.Equal(50, results.Count);
        Assert.Equal("k1", results[0].Key);
        Assert.Equal("k50", results[^1].Key);
        Assert.DoesNotContain(results, r => r.Key == "k51");
        Assert.Empty(_handler.RequestUris);
    }

    // A 429 mid-batch must not abort the batch or poison the cache: that item degrades to key-only,
    // the loop backs off, and the remaining items still get geocoded.
    [Fact]
    public async Task GeocodeBatchAsync_WhenAnItemIsRateLimited_BacksOffAndContinuesWithTheRest()
    {
        _handler.Enqueue(HttpStatusCode.TooManyRequests, "{}");
        _handler.Enqueue(HttpStatusCode.OK, LincolnJson);

        var results = await _sut.GeocodeBatchAsync([Omaha(), Lincoln()], CancellationToken.None);

        Assert.Equal(2, results.Count);
        Assert.Equal("cust-1", results[0].Key);
        Assert.Null(results[0].Lat);
        Assert.Equal(40.8136, results[1].Lat);
        Assert.Equal(2, _handler.RequestUris.Count);
        VerifyLoggedErrorWithoutAddress("INFRASTRUCTURE_GEOCODE_RATE_LIMITED");

        // The rate-limited item was NOT cached as a miss: a later lookup goes back to Nominatim.
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);
        var retried = await _sut.GeocodeSingleAsync(Omaha(), CancellationToken.None);
        Assert.Equal(41.2565, retried.Lat);
        Assert.Equal(3, _handler.RequestUris.Count);
    }

    [Fact]
    public async Task GeocodeBatchAsync_WhenItemsFail_ReturnsKeyOnlyForThoseAndCoordinatesForTheRest()
    {
        _handler.EnqueueThrow(new HttpRequestException("connection refused"));
        _handler.Enqueue(HttpStatusCode.InternalServerError, "{}");
        _handler.Enqueue(HttpStatusCode.OK, LincolnJson);
        var requests = new List<GeocodeRequest>
        {
            Omaha("net-fail"),
            new() { Key = "server-fail", City = "Kearney", State = "NE", Zip = "68845" },
            Lincoln("ok"),
        };

        var results = await _sut.GeocodeBatchAsync(requests, CancellationToken.None);

        Assert.Equal(["net-fail", "server-fail", "ok"], results.Select(r => r.Key));
        Assert.Null(results[0].Lat);
        Assert.Null(results[1].Lat);
        Assert.Equal(40.8136, results[2].Lat);
        Assert.Equal(3, _handler.RequestUris.Count);
    }

    // -------------------------------------------------------------------------
    // SearchAsync
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task SearchAsync_WhenQueryIsBlank_ReturnsEmptyWithoutCallingNominatim(string q)
    {
        var results = await _sut.SearchAsync(q, 5, CancellationToken.None);

        Assert.Empty(results);
        Assert.Empty(_handler.RequestUris);
    }

    [Theory]
    [InlineData(50, 5)]  // abuse cap
    [InlineData(0, 1)]   // floor
    [InlineData(3, 3)]   // in range passes through
    public async Task SearchAsync_ClampsTheLimitAndEscapesTheQuery(int requested, int expectedLimit)
    {
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);

        await _sut.SearchAsync("Omaha, NE", requested, CancellationToken.None);

        var url = Assert.Single(_handler.RequestUris);
        Assert.Contains($"limit={expectedLimit}", url);
        Assert.Contains("q=Omaha%2C%20NE", url);
        Assert.Contains("format=json", url);
    }

    // Regression: caching only results[0] collapsed the disambiguation dropdown to one option on
    // the second identical search. The whole list is cached, and handed back as a copy so a caller
    // mutating its list cannot corrupt the entry for everyone else.
    [Fact]
    public async Task SearchAsync_CachesTheWholeResultList_AndReturnsACopy()
    {
        _handler.Enqueue(HttpStatusCode.OK, """
            [{"lat":"41.25","lon":"-95.93"},{"lat":"41.26","lon":"-95.94"},{"lat":"41.27","lon":"-95.95"}]
            """);

        var first = await _sut.SearchAsync("Omaha", 5, CancellationToken.None);
        first.Clear(); // a misbehaving caller
        var second = await _sut.SearchAsync("  OMAHA ", 5, CancellationToken.None); // same query, different casing/padding

        Assert.Equal(3, second.Count);
        Assert.Equal(41.25, second[0].Lat);
        Assert.Equal(-95.95, second[2].Lng);
        Assert.Single(_handler.RequestUris);
    }

    [Fact]
    public async Task SearchAsync_WhenNominatimFails_ReturnsEmptyAndDoesNotCacheTheFailure()
    {
        _handler.Enqueue(HttpStatusCode.InternalServerError, "{}");
        _handler.Enqueue(HttpStatusCode.OK, OmahaJson);

        var failed = await _sut.SearchAsync("Omaha", 5, CancellationToken.None);
        var retried = await _sut.SearchAsync("Omaha", 5, CancellationToken.None);

        Assert.Empty(failed);
        Assert.Single(retried);
        Assert.Equal(2, _handler.RequestUris.Count);
        VerifyLoggedErrorWithoutAddress("INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
    }

    [Fact]
    public async Task SearchAsync_WhenTheNetworkFails_ReturnsEmpty()
    {
        _handler.EnqueueThrow(new HttpRequestException("connection refused"));

        var results = await _sut.SearchAsync("Omaha", 5, CancellationToken.None);

        Assert.Empty(results);
        VerifyLoggedErrorWithoutAddress("INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>Asserts exactly one Error-level log carrying <paramref name="errorCode"/>, and that
    /// the rendered message contains none of the address text used by these tests (M-014: only the
    /// SHA-256 fingerprint of the address may reach long-lived logs).</summary>
    private void VerifyLoggedErrorWithoutAddress(string errorCode)
    {
        _loggerMock.Verify(l => l.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((state, _) =>
                    state.ToString()!.Contains(errorCode) &&
                    !state.ToString()!.Contains("omaha", StringComparison.OrdinalIgnoreCase) &&
                    !state.ToString()!.Contains("68102") &&
                    !state.ToString()!.Contains("main st", StringComparison.OrdinalIgnoreCase)),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responses = new();
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        public List<string> RequestUris { get; } = [];
        public List<long> RequestTimestampsMs { get; } = [];

        public void Enqueue(HttpStatusCode status, string json) =>
            _responses.Enqueue(_ => new HttpResponseMessage(status)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });

        /// <summary>Makes the NEXT send throw. Per-item, so a batch can mix failures and successes.</summary>
        public void EnqueueThrow(Exception ex) => _responses.Enqueue(_ => throw ex);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            // AbsoluteUri, not ToString(): ToString() returns the display form, which unescapes
            // percent-encoding (q=Omaha%2C%20NE comes back as "q=Omaha, NE"), so an assertion
            // about escaping would be checking an unescaped string.
            RequestUris.Add(request.RequestUri!.AbsoluteUri);
            RequestTimestampsMs.Add(_clock.ElapsedMilliseconds);
            if (_responses.Count == 0)
                throw new InvalidOperationException("No stubbed response queued for " + request.RequestUri);
            return Task.FromResult(_responses.Dequeue()(request));
        }
    }
}
