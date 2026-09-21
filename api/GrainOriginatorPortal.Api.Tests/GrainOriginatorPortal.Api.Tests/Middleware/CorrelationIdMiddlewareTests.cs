// Microsoft namespaces
using Microsoft.AspNetCore.Http;

// Project namespaces
using GrainOriginatorPortal.Api.Middleware;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// The resolved correlation id becomes the TraceId on every log scope for the request, is echoed
/// into the response header, and is forwarded to downstream services. An inbound one used to be
/// trusted verbatim, so these pin the validation: an id-shaped value is honoured, anything that
/// could forge a log line or bloat ingestion is replaced rather than propagated.
/// </summary>
public class CorrelationIdMiddlewareTests
{
    private static async Task<HttpContext> RunWithHeader(string? inbound)
    {
        var ctx = new DefaultHttpContext();
        if (inbound is not null)
            ctx.Request.Headers[CorrelationIdMiddleware.HeaderName] = inbound;

        var middleware = new CorrelationIdMiddleware(_ => Task.CompletedTask);
        await middleware.InvokeAsync(ctx);
        return ctx;
    }

    private static string Resolved(HttpContext ctx) =>
        ctx.Items[CorrelationIdMiddleware.ItemsKey]!.ToString()!;

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("0af7651916cd43dd8448eb211c80319c")]  // W3C trace id
    [InlineData("8f14e45f-ceea-467a-9f0a-1b2c3d4e5f60")]  // GUID
    [InlineData("order_1234.attempt-2")]  // caller's own scheme
    public async Task InvokeAsync_HonoursAnIdShapedInboundHeader(string inbound)
    {
        var ctx = await RunWithHeader(inbound);

        Assert.Equal(inbound, Resolved(ctx));
        // Echoed back so the caller can correlate from their side too.
        Assert.Equal(inbound, ctx.Response.Headers[CorrelationIdMiddleware.HeaderName]);
    }

    [Theory]
    [InlineData("")]                                  // blank
    [InlineData("   ")]                               // whitespace only
    [InlineData("has space")]                         // would break log-field parsing
    [InlineData("line\nbreak")]                       // log forging
    [InlineData("quote\"injected")]                   // breaks structured-log JSON
    [InlineData("semi;colon")]
    public async Task InvokeAsync_ReplacesAMalformedInboundHeader(string inbound)
    {
        var ctx = await RunWithHeader(inbound);

        var resolved = Resolved(ctx);
        Assert.NotEqual(inbound, resolved);
        Assert.False(string.IsNullOrWhiteSpace(resolved));
    }

    [Fact]
    public async Task InvokeAsync_ReplacesAnOverlongInboundHeader()
    {
        // Unbounded values inflate Log Analytics ingestion on every line they touch.
        var tooLong = new string('a', CorrelationIdMiddleware.MaxLength + 1);

        var ctx = await RunWithHeader(tooLong);

        Assert.NotEqual(tooLong, Resolved(ctx));
        Assert.True(Resolved(ctx).Length <= CorrelationIdMiddleware.MaxLength);
    }

    [Fact]
    public async Task InvokeAsync_AtTheLengthLimit_IsStillHonoured()
    {
        // Boundary: MaxLength itself is acceptable, only longer is rejected.
        var atLimit = new string('a', CorrelationIdMiddleware.MaxLength);

        var ctx = await RunWithHeader(atLimit);

        Assert.Equal(atLimit, Resolved(ctx));
    }

    [Fact]
    public async Task InvokeAsync_WithNoInboundHeader_MintsOne()
    {
        var ctx = await RunWithHeader(null);

        Assert.False(string.IsNullOrWhiteSpace(Resolved(ctx)));
        Assert.Equal(Resolved(ctx), ctx.Response.Headers[CorrelationIdMiddleware.HeaderName]);
    }

    [Fact]
    public async Task InvokeAsync_AlwaysCallsTheRestOfThePipeline()
    {
        // A malformed header must not fail otherwise-valid work — the id is a diagnostic
        // convenience, not a credential.
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers[CorrelationIdMiddleware.HeaderName] = "bad\nvalue";
        var called = false;

        var middleware = new CorrelationIdMiddleware(_ => { called = true; return Task.CompletedTask; });
        await middleware.InvokeAsync(ctx);

        Assert.True(called);
    }
}
