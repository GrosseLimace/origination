namespace GrainOriginatorPortal.Infrastructure.Exceptions;

/// <summary>
/// A bid sheet location could not be created because an equivalent one already exists on that trade
/// unit — raised only when the database's unique index catches it, i.e. when two creates raced past the
/// application's own pre-check.
///
/// It exists so the API layer can answer 400 for that race exactly as it does for the serialized case.
/// Without it the race surfaced as a raw <see cref="Microsoft.EntityFrameworkCore.DbUpdateException"/>
/// and became a 500, which the BarChart bulk add then reported as a real failure to retry rather than
/// as a placement that was already there. Infrastructure cannot reference the API's ValidationException,
/// hence a domain exception the service translates.
/// </summary>
public class DuplicateLocationException : Exception
{
    public DuplicateLocationException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}
