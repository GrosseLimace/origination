namespace GrainOriginatorPortal.Api.Services;

/// <summary>Resolves an incoming caller id to the producers whose stored phone numbers match it.</summary>
public interface ICallingMatchService
{
    /// <summary>
    /// Producers whose phone on file contains the caller's digits. Empty when the number is too
    /// short to match meaningfully (fewer than 7 digits) or nobody matches. Never throws for bad
    /// input; the popup must render an "unknown caller" state rather than an error.
    /// </summary>
    Task<List<IncomingCallMatchResponse>> MatchAsync(string? callerNumber, CancellationToken cancellationToken);
}
