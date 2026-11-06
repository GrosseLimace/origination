namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>
/// The only code that reads roles (plan §4.3). Everything else asks about permissions, which come from the
/// caller's roles through the grants in the database.
/// </summary>
public interface IPermissionService
{
    /// <summary>The caller's roles, permissions, segments and modules. Worked out once per request.</summary>
    Task<UserAccess> GetAccessAsync(CancellationToken cancellationToken = default);

    /// <summary>Whether the caller holds <paramref name="permission"/>, such as <c>notes:write</c>.</summary>
    Task<bool> HasPermissionAsync(string permission, CancellationToken cancellationToken = default);
}
