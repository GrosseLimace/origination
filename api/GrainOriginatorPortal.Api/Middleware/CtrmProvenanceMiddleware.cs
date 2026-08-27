using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Stamps each response with which source served its contract and ticket data.
/// </summary>
/// <remarks>
/// <para>Lets the browser's Network tab answer "did this come from CTRM?" directly. The two sources
/// are mapped to be indistinguishable in the response body, so without a header there is no way to
/// tell from the client — and a comparison run against the wrong assumption is worse than no
/// comparison.</para>
///
/// <para>Written in <c>OnStarting</c> so the values reflect what the repositories actually recorded
/// while handling the request, not what was configured when it arrived.</para>
///
/// <para>Non-production only. These headers describe internal data sources, and while they carry no
/// customer data they are diagnostic detail that has no reason to reach a production response.</para>
///
/// <para>Also emits <c>Server-Timing</c>, which the browser surfaces natively in the Network tab. That
/// makes every click during testing a measurement rather than only the ones someone remembers to probe.</para>
/// </remarks>
public sealed class CtrmProvenanceMiddleware
{
    private readonly RequestDelegate _next;

    public CtrmProvenanceMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, CtrmProvenance provenance)
    {
        context.Response.OnStarting(() =>
        {
            // Headers cannot be added once the response has begun; OnStarting is the last safe point.
            // No header at all when the request read neither contracts nor tickets — saying "ods" there
            // would imply a read happened.
            if (provenance.Source is { } source)
                context.Response.Headers[CtrmProvenance.SourceHeader] = source;

            if (provenance.Contracts is { } contracts)
                context.Response.Headers[CtrmProvenance.ContractsHeader] = contracts;

            if (provenance.Tickets is { } tickets)
                context.Response.Headers[CtrmProvenance.TicketsHeader] = tickets;

            // Server-Timing puts the server-side cost of this request in the browser's Network tab, so a
            // slow click can be attributed without opening a log or calling the diagnostics endpoint.
            var timings = new List<string>(2);
            if (provenance.ContractsMs is { } contractsMs)
                timings.Add($"ctrm-contracts;dur={contractsMs}");
            if (provenance.TicketsMs is { } ticketsMs)
                timings.Add($"ctrm-tickets;dur={ticketsMs}");
            if (timings.Count > 0)
                context.Response.Headers["Server-Timing"] = string.Join(", ", timings);

            return Task.CompletedTask;
        });

        await _next(context);
    }
}
