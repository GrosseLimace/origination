namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// An Azure Communication Services access token minted for the CALLING USER'S OWN Teams identity.
/// The browser hands it to the ACS Calling SDK, which then registers the tab as one more of that
/// user's Teams Phone endpoints (alongside the Teams desktop and mobile apps) so incoming calls to
/// their number ring here too. Short-lived; the client refreshes it through the same endpoint.
/// </summary>
public record CallingTokenResponse
{
    public required string Token { get; init; }
    public required DateTimeOffset ExpiresOn { get; init; }
}
