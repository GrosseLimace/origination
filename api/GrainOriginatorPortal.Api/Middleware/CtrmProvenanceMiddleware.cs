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

            return Task.CompletedTask;
        });

        await _next(context);
    }
}
