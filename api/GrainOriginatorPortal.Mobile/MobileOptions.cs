namespace GrainOriginatorPortal.Mobile;

/// <summary>
/// Configuration for the mobile surface, bound from the <c>Mobile</c> section of appsettings.
/// Environment-specific values (scope names, client ids) live in appsettings.{Env}.json.
/// </summary>
public sealed class MobileOptions
{
    public const string SectionName = "Mobile";

    /// <summary>
    /// Delegated scopes that mark a token as a mobile token, e.g. <c>Origination.Mobile.Dev</c>.
    /// A token must carry at least one. Empty means no token can reach the mobile surface
    /// (fail closed), which is the safe default for an environment that has not been configured.
    /// </summary>
    public string[] RequiredScopes { get; set; } = [];

    /// <summary>
    /// Client (application) ids of the mobile app registrations, matched against the token's
    /// <c>azp</c>/<c>appid</c> claim. Empty means the client-id check is skipped and the scope alone
    /// decides — acceptable while the dedicated registrations are being created (see
    /// PLATFORM-REQUESTS.md E3), and logged as a warning at startup. QA and Production must set it.
    /// </summary>
    public string[] AllowedClientAppIds { get; set; } = [];

    /// <summary>
    /// Shared sign-in, as Grain Vision's external app (and Burdi) do (user 2026-10-15): the phone signs in with the
    /// desktop SPA registration and the desktop scope, so <see cref="RequiredScopes"/> is the desktop scope and
    /// <see cref="AllowedClientAppIds"/> the desktop SPA's client id. One token then serves both surfaces, so the
    /// DesktopAccess separation is off; what keeps the rest of the API out of reach from the internet is that the App
    /// Service is private and APIM exposes only the operations in openapi/mobile/specification.yaml.
    /// False = separate mobile registration + scope, kept off the desktop surface (the stricter model; switch back by
    /// creating them and setting the mobile scope and client ids).
    /// </summary>
    public bool SharedSignIn { get; set; }

    /// <summary>
    /// Extra audiences accepted by the JWT bearer handler, in case Data Integrations configures
    /// APIM to forward a token with an APIM-owned audience. Empty is the expected (pass-through)
    /// case; see PLATFORM-REQUESTS.md E8.
    /// </summary>
    public string[] AdditionalAudiences { get; set; } = [];

    /// <summary>
    /// Trade units that always count as offering storage (card #648). Normally empty: whether a trade unit
    /// offers storage is derived from its DP and storage rows (TradeUnitStorageLookup, decided 2026-10-14).
    /// Add a code here only to force the Storage tab on, e.g. for a programme that has no rows yet.
    /// </summary>
    public string[] StorageTradeUnits { get; set; } = [];

    /// <summary>Sliding-window permit count per user per minute on api/mobile/v1 (APIM is the primary limiter).</summary>
    public int RateLimitPermitPerMinute { get; set; } = 120;
}
