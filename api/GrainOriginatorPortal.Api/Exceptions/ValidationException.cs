namespace GrainOriginatorPortal.Api.Exceptions;

/// <summary>
/// Exception thrown when one or more validation rules fail.
/// </summary>
public class ValidationException : AppException
{
    public IReadOnlyDictionary<string, string[]> Errors { get; }

    public ValidationException(IDictionary<string, string[]> errors)
        : base("One or more validation errors occurred.", "VALIDATION_ERROR")
    {
        Errors = new Dictionary<string, string[]>(errors);
    }

    public ValidationException(string field, string message)
        : base(message, "VALIDATION_ERROR")
    {
        Errors = new Dictionary<string, string[]>
        {
            [field] = [message]
        };
    }
}
