namespace GrainOriginatorPortal.Api.Exceptions;

/// <summary>
/// Base exception for all application-specific errors.
/// </summary>
public abstract class AppException : Exception
{
    public string ErrorCode { get; }

    // A Context dictionary and a fluent WithContext(key, value) used to live here. Nothing ever
    // read them — GlobalExceptionHandler, the error responses and the tests all ignored Context —
    // and the only writer (NotFoundException) stored an entity name and key its own message
    // already spells out. Write-only state is worse than no state, so it's gone rather than wired
    // up. Add it back properly (i.e. with a reader) if structured context is ever wanted.

    // -------------------------------------------------------------------------
    protected AppException(string message, string errorCode)
        : base(message)
    {
        ErrorCode = errorCode;
    }

    protected AppException(string message, string errorCode, Exception innerException)
        : base(message, innerException)
    {
        ErrorCode = errorCode;
    }
}
