// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Interfaces;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>
/// The access map as this build understands it: every role by name, without regard to case (as
/// <c>dbo.Roles.Name</c> is unique). Grants naming a permission this build doesn't know are dropped.
/// </summary>
public sealed class AccessGrants
{
    private AccessGrants(Dictionary<string, RoleGrants> roles) => Roles = roles;

    public IReadOnlyDictionary<string, RoleGrants> Roles { get; }

    /// <summary>
    /// Builds the map from the database's rows. A grant can name a permission this build lacks when the
    /// database is ahead of the code, such as mid-deploy; it grants nothing and is reported in
    /// <paramref name="unknownPermissions"/>.
    /// </summary>
    public static AccessGrants From(IEnumerable<RoleGrants> roles, out IReadOnlyList<string> unknownPermissions)
    {
        var unknown = new SortedSet<string>(StringComparer.Ordinal);
        var known = new Dictionary<string, RoleGrants>(StringComparer.OrdinalIgnoreCase);
        foreach (var role in roles)
        {
            unknown.UnionWith(role.Permissions.Where(p => !AppPermissions.ModuleOf.ContainsKey(p)));
            known[role.Name] = role with
            {
                Permissions = role.Permissions.Where(AppPermissions.ModuleOf.ContainsKey).ToHashSet(StringComparer.Ordinal),
            };
        }

        unknownPermissions = unknown.ToList();
        return new AccessGrants(known);
    }
}
