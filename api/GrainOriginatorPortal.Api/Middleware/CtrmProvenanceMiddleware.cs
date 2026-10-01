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
/// <para>In Production the headers are emitted only for users allowed to choose their data source
/// (<c>Ctrm:SourceToggleUsers</c>): they are the ones comparing CTRM against ODS and need the proof, and
/// their choice is what the header confirms. For everyone else a production response carries none of this
/// diagnostic detail, which is how it was before the toggle existed. Non-production emits for all.</para>
///
/// <para>Also emits <c>Server-Timing</c>, which the browser surfaces natively in the Network tab. That
/// makes every click during testing a measurement rather than only the ones someone remembers to probe.</para>
/// </remarks>
public sealed class CtrmProvenanceMiddleware
{
    /// <summary>Whether the user's own preference decided the source: <c>user</c>, else <c>default</c>.</summary>
    public const string ChoiceHeader = "X-Data-Source-Choice";

    private readonly RequestDelegate _next;
    private readonly IHostEnvironment _env;
    private readonly IConfiguration _configuration;

    public CtrmProvenanceMiddleware(RequestDelegate next, IHostEnvironment env, IConfiguration configuration)
    {
        _next = next;
        _env = env;
        _configuration = configuration;
    }

    public async Task InvokeAsync(HttpContext context, CtrmProvenance provenance, CtrmSourceChoice choice)
    {
        if (_env.IsProduction() && !choice.CanChoose(_configuration))
        {
            await _next(context);
            return;
        }

        context.Response.OnStarting(() =>
        {
            // Headers cannot be added once the response has begun; OnStarting is the last safe point.
            // No header at all when the request read neither contracts nor tickets — saying "ods" there
            // would imply a read happened.
            if (provenance.Source is { } source)
            {
                context.Response.Headers[CtrmProvenance.SourceHeader] = source;
                context.Response.Headers[ChoiceHeader] = choice.UserChoiceApplied(_configuration) ? "user" : "default";
            }

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
