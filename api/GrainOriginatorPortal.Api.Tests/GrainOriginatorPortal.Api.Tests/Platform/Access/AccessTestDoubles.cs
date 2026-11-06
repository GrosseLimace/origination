// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.Extensions.Options;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

/// <summary>A clock the test moves by hand.</summary>
internal sealed class ManualTimeProvider : TimeProvider
{
    private DateTimeOffset _now = new(2026, 11, 4, 12, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan by) => _now += by;
}

/// <summary>Fixed options, readable through <see cref="IOptionsMonitor{TOptions}"/>.</summary>
internal sealed class FixedOptionsMonitor<T>(T value) : IOptionsMonitor<T>
{
    public T CurrentValue => value;

    public T Get(string? name) => value;

    public IDisposable? OnChange(Action<T, string?> listener) => null;
}

/// <summary>Roles shaped like the first seed, small enough to read in a test.</summary>
internal static class TestGrants
{
    public static readonly RoleGrants Admin = Role("Admin", RoleKind.Base, isSystem: true, AppPermissions.All, CustomerSegments.All);

    public static readonly RoleGrants Originator = Role("Originator", RoleKind.Persona, isSystem: false,
        [AppPermissions.Engagement.NotesRead, AppPermissions.Customers.CustomersRead, AppPermissions.Platform.PreferencesWriteOwn],
        [CustomerSegments.Producer]);

    public static readonly RoleGrants Support = Role("Support", RoleKind.Persona, isSystem: false,
        [AppPermissions.Engagement.NotesRead, AppPermissions.Platform.DiagnosticsRead, AppPermissions.Platform.DiagnosticsManage],
        CustomerSegments.All);

    public static readonly RoleGrants Editor = Role("Editor", RoleKind.AddOn, isSystem: false,
        [AppPermissions.Engagement.NotesWrite, AppPermissions.Customers.CustomersWrite], []);

    public static readonly RoleGrants Manager = Role("Manager", RoleKind.AddOn, isSystem: false,
        [AppPermissions.UsageAnalytics.UsageReportsRead], []);

    public static IReadOnlyList<RoleGrants> All => [Admin, Originator, Support, Editor, Manager];

    public static AccessGrants Map(params RoleGrants[] roles) => AccessGrants.From(roles.Length > 0 ? roles : All, out _);

    public static RoleGrants Role(string name, string kind, bool isSystem, IEnumerable<string> permissions, IEnumerable<string> segments) =>
        new(name, kind, isSystem, permissions.ToHashSet(StringComparer.Ordinal), segments.ToHashSet(StringComparer.Ordinal));
}

/// <summary>Builds the principal an access token produces.</summary>
internal static class TestUsers
{
    /// <param name="delegated">A signed-in person's token carries an <c>scp</c> claim; an app-only token doesn't.</param>
    public static ClaimsPrincipal Signed(bool delegated, params string[] roles)
    {
        var claims = new List<Claim> { new("preferred_username", "jane.doe@example.com"), new("oid", "00000000-0000-0000-0000-000000000001") };
        if (delegated)
        {
            claims.Add(new Claim("scp", "access_as_user"));
        }

        claims.AddRange(roles.Select(r => new Claim("roles", r)));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "Bearer", nameType: "name", roleType: "roles"));
    }

    public static ClaimsPrincipal Person(params string[] roles) => Signed(delegated: true, roles);

    public static ClaimsPrincipal Anonymous() => new(new ClaimsIdentity());
}
