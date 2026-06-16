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

    /// <summary>The correlation id for the current request, falling back to the trace identifier.</summary>
    string GetTraceId();
}
