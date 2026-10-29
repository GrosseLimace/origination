namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// Body of <c>POST /api/calling/match</c>: the caller id the browser's calling SDK delivered. It is a
/// producer's phone number (PII), so it travels in the body rather than the query string: App Service
/// auto-instrumentation records the full request URL, query included, in Application Insights
/// (<c>requests.url</c>), but never the body.
/// </summary>
public record MatchIncomingCallRequest
{
    public string? Number { get; init; }
}
