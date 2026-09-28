using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Resolves the producer code a CTRM read was asked for.
/// </summary>
/// <remarks>
/// The customer-to-code mapping is ours, not CTRM's: it says which producer the caller meant, and is not an
/// ODS source for contract or ticket content. The contract and ticket repositories both need it and had
/// identical private copies, differing only in the label on the warning. One copy means the fallback rule
/// cannot drift between the two surfaces.
/// </remarks>
public static class CtrmProducerCode
{
    /// <summary>
    /// Returns the caller-supplied code when there is one, otherwise looks it up by customer id.
    /// </summary>
    /// <param name="appContext">The Origination database, which owns the customer-to-code mapping.</param>
    /// <param name="logger">Logger of the calling repository, so the warning keeps its own category.</param>
    /// <param name="what">
    /// What is being read, for the warning text, e.g. <c>"CTRM contracts"</c> or <c>"CTRM tickets"</c>.
    /// </param>
    /// <param name="customerId">Customer to resolve when <paramref name="scoularId"/> is absent.</param>
    /// <param name="scoularId">Code the caller already supplied, if any.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// The trimmed producer code, or <see langword="null"/> when the customer does not exist or carries no
    /// code. Null is a legitimate "nothing to ask CTRM for", not an error, so it warns rather than throws.
    /// </returns>
    public static async Task<string?> ResolveAsync(
        ApplicationDbContext appContext,
        ILogger logger,
        string what,
        long customerId,
        string? scoularId,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(scoularId)) return scoularId.Trim();

        var resolved = await appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => c.ScoularId)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(resolved))
        {
            logger.LogWarning("{What}: customer {CustomerId} not found or has no ScoularId.", what, customerId);
            return null;
        }

        return resolved.Trim();
    }
}
