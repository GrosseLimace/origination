namespace GrainOriginatorPortal.Api.Exceptions;

/// <summary>
/// Exception thrown when an authenticated user attempts to access a resource
/// they are not authorized for. Maps to HTTP 403 (Forbidden).
/// </summary>
public class ForbiddenException : AppException
{
    public ForbiddenException(string message)
        : base(message, "AUTHORIZATION_FORBIDDEN")
    {
    }

    public ForbiddenException(string message, Exception innerException)
        : base(message, "AUTHORIZATION_FORBIDDEN", innerException)
    {
    }
}
