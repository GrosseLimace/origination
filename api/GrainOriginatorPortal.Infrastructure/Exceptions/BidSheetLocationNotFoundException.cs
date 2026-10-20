namespace GrainOriginatorPortal.Infrastructure.Exceptions;

/// <summary>
/// A bid could not be written because the location it names does not exist.
///
/// The bulk upsert used to invent a location in this situation. That was tolerable while locations were
/// scoped to a trade unit — the name lookup was deterministic and a unique index kept it so — but with
/// company-wide locations a typo would fork a new row that everybody then sees. Failing is the safer
/// answer, and failing LOUDLY is the point: a silently dropped bid reports success and is simply absent
/// the next time the user looks, which is far worse than an error they can act on.
///
/// Translated to a 400 by the API layer, the same way DuplicateLocationException is.
/// </summary>
public class BidSheetLocationNotFoundException : Exception
{
    public BidSheetLocationNotFoundException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}
