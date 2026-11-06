namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Request-scoped helpers that read the current <see cref="HttpContext"/> — the stable
/// current-user identifier (for CreatedBy/ModifiedBy ownership) and the correlation/trace id
/// (for error-log correlation). These are about the <em>current request</em>, not data access,
/// so they live in the Api layer rather than a repository.
/// </summary>
public interface IRequestContextService
{
    /// <summary>
    /// A stable, unique identifier for the current user.
    /// Priority: preferred_username (UPN) &gt; UPN claim &gt; oid (AAD object id) &gt; Identity.Name &gt; "System".
    /// The display-name claim ("name") is intentionally NOT used — display names can collide across
    /// users and are unstable, which would corrupt CreatedBy/ModifiedBy ownership on persisted rows.
    /// </summary>
    string GetCurrentUser();

    /// <summary>
    /// The current user's short identifier — the UPN with any "@domain" stripped (e.g.
    /// "CEgr@scoular.com" → "CEgr"). This is the key used by the TradeUnitPreferences DB and per-user
    /// preference tables, which store the short form rather than the full UPN.
    /// </summary>
    string GetCurrentUserShortName();

    /// <summary>
    /// The current user's display name (the "name" claim, e.g. "Chris Egr") for showing a person on a
    /// document. Not an identifier: store <see cref="GetCurrentUser"/> alongside it. Falls back to it.
    /// </summary>
    string GetCurrentUserDisplayName();

    /// <summary>The correlation id for the current request, falling back to the trace identifier.</summary>
    string GetTraceId();
}
