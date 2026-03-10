namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// DelegatingHandler that forwards the X-Correlation-Id header to all outbound
/// HTTP requests made through HttpClients that include this handler.
/// Satisfies error-handling-standards.md §8: traceId must propagate through
/// ALL downstream calls, queues, and jobs.
/// </summary>
public class CorrelationIdOutboundHandler : DelegatingHandler
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CorrelationIdOutboundHandler(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    // -------------------------------------------------------------------------
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var correlationId = _httpContextAccessor.HttpContext
            ?.Items[CorrelationIdMiddleware.ItemsKey]?.ToString();

        if (!string.IsNullOrEmpty(correlationId))
        {
            request.Headers.TryAddWithoutValidation(CorrelationIdMiddleware.HeaderName, correlationId);
        }

        return base.SendAsync(request, cancellationToken);
    }
}
