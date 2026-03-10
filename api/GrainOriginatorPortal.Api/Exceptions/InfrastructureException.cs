namespace GrainOriginatorPortal.Api.Exceptions;

/// <summary>
/// Exception thrown when an external dependency or system component fails.
/// Maps to HTTP 503 (Service Unavailable) by default; use 502 for bad upstream gateway
/// or 504 for upstream timeout.
/// </summary>
public class InfrastructureException : AppException
{
    /// <summary>HTTP status code to return — 502, 503, or 504.</summary>
    public int HttpStatusCode { get; }

    public InfrastructureException(string message, string errorCode, int httpStatusCode = StatusCodes.Status503ServiceUnavailable)
        : base(message, errorCode)
    {
        HttpStatusCode = httpStatusCode;
    }

    public InfrastructureException(string message, string errorCode, Exception innerException, int httpStatusCode = StatusCodes.Status503ServiceUnavailable)
        : base(message, errorCode, innerException)
    {
        HttpStatusCode = httpStatusCode;
    }
}
