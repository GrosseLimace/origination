namespace GrainOriginatorPortal.Api.Exceptions;

/// <summary>
/// Exception thrown when valid input violates a domain or business rule.
/// Maps to HTTP 409 (Conflict) by default, or 422 (Unprocessable Entity) for semantic violations.
/// </summary>
public class BusinessException : AppException
{
    /// <summary>HTTP status code to return — 409 or 422.</summary>
    public int HttpStatusCode { get; }

    public BusinessException(string message, string errorCode, int httpStatusCode = StatusCodes.Status409Conflict)
        : base(message, errorCode)
    {
        HttpStatusCode = httpStatusCode;
    }
}
