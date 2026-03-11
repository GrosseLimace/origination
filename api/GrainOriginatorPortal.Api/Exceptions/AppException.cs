namespace GrainOriginatorPortal.Api.Exceptions;

/// <summary>
/// Base exception for all application-specific errors.
/// </summary>
public abstract class AppException : Exception
{
    public string ErrorCode { get; }
    public IDictionary<string, object> Context { get; }

    // -------------------------------------------------------------------------
    protected AppException(string message, string errorCode)
        : base(message)
    {
        ErrorCode = errorCode;
        Context = new Dictionary<string, object>();
    }

    protected AppException(string message, string errorCode, Exception innerException)
        : base(message, innerException)
    {
        ErrorCode = errorCode;
        Context = new Dictionary<string, object>();
    }

    public AppException WithContext(string key, object value)
    {
        Context[key] = value;
        return this;
    }
}
