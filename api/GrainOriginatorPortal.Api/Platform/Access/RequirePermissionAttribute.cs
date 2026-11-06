// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>
/// Requires the caller to hold <paramref name="permission"/>, as in
/// <c>[RequirePermission(AppPermissions.Engagement.NotesWrite)]</c>.
/// </summary>
/// <remarks>
/// <para>It names a policy such as <c>Permission:notes:write</c>, one of which
/// <see cref="AccessServiceCollectionExtensions.AddAccess"/> registers for each catalog permission. That policy
/// carries every requirement of the default policy too, so this attribute can't let in anyone a plain
/// <c>[Authorize]</c> would turn away.</para>
/// <para>Every attribute that applies must pass. A read permission on the controller and a write permission on
/// an action means the write needs both.</para>
/// <para>Pass an <c>AppPermissions</c> constant, never a string literal. A permission outside the catalog has
/// no policy, and a test fails on it.</para>
/// </remarks>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
public sealed class RequirePermissionAttribute(string permission) : AuthorizeAttribute(PolicyFor(permission))
{
    public const string PolicyPrefix = "Permission:";

    public string Permission { get; } = permission;

    /// <summary>The policy name for <paramref name="permission"/>: <c>Permission:notes:write</c>.</summary>
    public static string PolicyFor(string permission) => PolicyPrefix + permission;
}
