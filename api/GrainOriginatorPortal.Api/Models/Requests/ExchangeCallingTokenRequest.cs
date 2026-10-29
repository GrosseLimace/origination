namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// Body of <c>POST /api/calling/token</c>: the Entra access token the browser acquired for the Azure
/// Communication Services scopes (<c>Teams.ManageCalls</c> / <c>Teams.ManageChats</c>). It is a bearer
/// credential, so it is never logged; the API only forwards it to ACS for the exchange.
/// </summary>
public record ExchangeCallingTokenRequest
{
    public string? TeamsUserAadToken { get; init; }
}
