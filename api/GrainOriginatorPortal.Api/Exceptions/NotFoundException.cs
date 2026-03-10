namespace GrainOriginatorPortal.Api.Exceptions;

/// <summary>
/// Exception thrown when a requested entity is not found.
/// </summary>
public class NotFoundException : AppException
{
    public NotFoundException(string entityName, object key)
        : base($"{entityName} with key '{key}' was not found.", "RESOURCE_NOT_FOUND")
    {
        WithContext("EntityName", entityName);
        WithContext("Key", key);
    }
}
