// System namespaces
using System.Reflection;
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

/// <summary>
/// Checks the roles and grants the migrations seed, without a database: every <c>ApplicationDbContext</c>
/// migration is replayed in order and its inserts and deletes on the access tables are folded into the final
/// state. These are the seed rules of plan §7.1 and §7.3. Roles and grants changed later in the grant editor
/// are data, and the access-map endpoint shows them per environment.
/// </summary>
public class AccessSeedTests
{
    // Roles are data, so code never names one. Only these tests, which pin the first seed, do.
    private const string Admin = "Admin";
    private const string Originator = "Originator";
    private const string Support = "Support";
    private const string Editor = "Editor";
    private const string Manager = "Manager";

    private static readonly Lazy<SeededAccess> Seeded = new(SeededAccess.Replay);

    // What only managers and IT may do today: Admin-only endpoints, the ExclusionManagers list and the
    // pipeline's feed, mapped to permissions (plan §7.2).
    private static readonly string[] OversightAndItPermissions =
    [
        AppPermissions.Platform.DiagnosticsRead, AppPermissions.Platform.DiagnosticsManage, AppPermissions.Platform.RolesManage,
        AppPermissions.Customers.CustomerSyncManage,
        AppPermissions.Lists.SavedListsReadTeam, AppPermissions.Lists.SavedListsWriteTeam,
        AppPermissions.BidSheet.BidSheetLocationsDeleteGlobal, AppPermissions.BidSheet.BidFeedManage,
        AppPermissions.UsageAnalytics.UsageReportsRead, AppPermissions.UsageAnalytics.UsageExclusionsManage,
    ];

    [Fact]
    public void SeededRoles_AreThePlannedRoles()
    {
        (string Name, string Kind, bool IsSystem)[] expected =
        [
            (Admin, RoleKind.Base, true),
            (Editor, RoleKind.AddOn, false),
            (Manager, RoleKind.AddOn, false),
            (Originator, RoleKind.Persona, false),
            (Support, RoleKind.Persona, false),
        ];

        Assert.Equal(expected, Seeded.Value.Roles.Values.Select(r => (r.Name, r.Kind, r.IsSystem)).OrderBy(r => r.Name, StringComparer.Ordinal));
    }

    [Fact]
    public void TheBaseRole_IsTheOnlySystemRole()
    {
        Assert.All(Seeded.Value.Roles.Values, r => Assert.Equal(r.Kind == RoleKind.Base, r.IsSystem));
    }

    [Fact]
    public void TheBaseRole_HoldsEveryPermissionAndEverySegment()
    {
        // Style guide §3.1: the Admin base role has full access.
        foreach (var role in Seeded.Value.Roles.Values.Where(r => r.Kind == RoleKind.Base))
        {
            var missing = AppPermissions.All.Except(Seeded.Value.PermissionsOf(role.Name)).ToList();

            Assert.True(missing.Count == 0, $"{role.Name} must hold every permission. Missing: {string.Join(", ", missing)}");
            Assert.Equal(CustomerSegments.All.Order(), Seeded.Value.SegmentsOf(role.Name));
        }
    }

    [Fact]
    public void AddOnRoles_HoldNoSegments()
    {
        // Add-ons decide what you may do, never which customers you see (plan §7.3).
        Assert.All(Seeded.Value.Roles.Values.Where(r => r.Kind == RoleKind.AddOn), r => Assert.Empty(Seeded.Value.SegmentsOf(r.Name)));
    }

    [Fact]
    public void EveryGrant_NamesACatalogPermissionAndASeededRole()
    {
        var unknownPermissions = Seeded.Value.Grants.Select(g => g.Permission).Except(AppPermissions.All).ToList();
        var unknownRoles = Seeded.Value.Grants.Select(g => g.Role)
            .Concat(Seeded.Value.Segments.Select(s => s.Role))
            .Except(Seeded.Value.Roles.Keys)
            .ToList();

        Assert.Empty(unknownPermissions);
        Assert.Empty(unknownRoles);
    }

    [Fact]
    public void Support_ReadsEverythingButWritesNoBusinessData()
    {
        // IT may see everything in production but edit no business data (plan §7.3). Personal writes
        // (:own) and operational powers (manage) are allowed.
        var support = Seeded.Value.PermissionsOf(Support).ToList();
        var everyRead = AppPermissions.All.Where(p => ActionOf(p) == "read");
        var businessWrites = support.Where(p => ActionOf(p) is "write" or "delete" && !p.EndsWith(":own", StringComparison.Ordinal)).ToList();

        Assert.Empty(everyRead.Except(support));
        Assert.True(businessWrites.Count == 0, $"Support must not write business data: {string.Join(", ", businessWrites)}");
        Assert.Equal(CustomerSegments.All.Order(), Seeded.Value.SegmentsOf(Support));
    }

    [Fact]
    public void DefaultRoles_ReproduceWhatANonAdminCanDoToday()
    {
        // Until the entitlements app issues personas, everyone gets Originator + Editor (plan §7.1). That
        // must be exactly today's non-admin access: everything except the manager and IT powers.
        var defaults = Seeded.Value.PermissionsOf(Originator)
            .Union(Seeded.Value.PermissionsOf(Editor))
            .Order(StringComparer.Ordinal);

        Assert.Equal(AppPermissions.All.Except(OversightAndItPermissions).Order(StringComparer.Ordinal), defaults);
        Assert.Equal(new[] { CustomerSegments.Producer }, Seeded.Value.SegmentsOf(Originator));
    }

    [Fact]
    public void Editor_HoldsOnlyWrites()
    {
        // An add-on acts only where a persona grants the read, so Editor must never carry a read itself.
        Assert.All(Seeded.Value.PermissionsOf(Editor), p => Assert.Equal("write", ActionOf(p)));
    }

    [Fact]
    public void NoMigration_ChangesAccessInAWayTheReplayCannotRead()
    {
        // The replay reads only InsertData and DeleteData. Raw SQL or UpdateData on these tables would be invisible to it.
        Assert.Empty(Seeded.Value.ChangesTheReplayCannotRead);
    }

    private static string ActionOf(string permission) => permission.Split(':')[1];

    private sealed record SeededRole(string Name, string Kind, bool IsSystem);

    /// <summary>The access tables as the migrations leave them.</summary>
    private sealed class SeededAccess
    {
        // Whole words only, so a table such as UserRoles doesn't count.
        private static readonly Regex AccessTable = new(@"\b(Roles|RolePermissions|RoleSegments)\b");

        public Dictionary<Guid, SeededRole> Roles { get; } = [];
        public HashSet<(Guid Role, string Permission)> Grants { get; } = [];
        public HashSet<(Guid Role, string Segment)> Segments { get; } = [];
        public List<string> ChangesTheReplayCannotRead { get; } = [];

        public IEnumerable<string> PermissionsOf(string roleName) =>
            Grants.Where(g => g.Role == IdOf(roleName)).Select(g => g.Permission).Order(StringComparer.Ordinal);

        public IEnumerable<string> SegmentsOf(string roleName) =>
            Segments.Where(s => s.Role == IdOf(roleName)).Select(s => s.Segment).Order(StringComparer.Ordinal);

        private Guid IdOf(string roleName) => Roles.Single(r => r.Value.Name == roleName).Key;

        public static SeededAccess Replay()
        {
            var state = new SeededAccess();
            var migrations = typeof(ApplicationDbContext).Assembly.GetTypes()
                .Where(t => typeof(Migration).IsAssignableFrom(t) && !t.IsAbstract
                            && t.GetCustomAttribute<DbContextAttribute>()?.ContextType == typeof(ApplicationDbContext))
                .OrderBy(t => t.GetCustomAttribute<MigrationAttribute>()!.Id, StringComparer.Ordinal);

            foreach (var type in migrations)
            {
                var migration = (Migration)Activator.CreateInstance(type)!;
                migration.ActiveProvider = "Microsoft.EntityFrameworkCore.SqlServer";
                foreach (var operation in migration.UpOperations)
                {
                    state.Apply(type.Name, operation);
                }
            }

            return state;
        }

        private void Apply(string migration, MigrationOperation operation)
        {
            switch (operation)
            {
                case InsertDataOperation insert:
                    foreach (var row in Rows(insert.Columns, insert.Values))
                    {
                        switch (insert.Table)
                        {
                            case "Roles":
                                Roles[(Guid)row["Id"]!] = new SeededRole((string)row["Name"]!, (string)row["Kind"]!, (bool)row["IsSystem"]!);
                                break;
                            case "RolePermissions":
                                Grants.Add(((Guid)row["RoleId"]!, (string)row["PermissionId"]!));
                                break;
                            case "RoleSegments":
                                Segments.Add(((Guid)row["RoleId"]!, (string)row["Segment"]!));
                                break;
                        }
                    }

                    break;

                case DeleteDataOperation delete:
                    foreach (var key in Rows(delete.KeyColumns, delete.KeyValues))
                    {
                        switch (delete.Table)
                        {
                            case "Roles":
                                Roles.Remove((Guid)key["Id"]!);
                                break;
                            case "RolePermissions":
                                Grants.Remove(((Guid)key["RoleId"]!, (string)key["PermissionId"]!));
                                break;
                            case "RoleSegments":
                                Segments.Remove(((Guid)key["RoleId"]!, (string)key["Segment"]!));
                                break;
                        }
                    }

                    break;

                case UpdateDataOperation update when update.Table is "Roles" or "RolePermissions" or "RoleSegments":
                    // Not folded in; a role's kind or system flag changed this way would be missed.
                    ChangesTheReplayCannotRead.Add($"{migration} (UpdateData on {update.Table})");
                    break;

                case SqlOperation sql when AccessTable.IsMatch(sql.Sql):
                    ChangesTheReplayCannotRead.Add(migration);
                    break;
            }
        }

        private static IEnumerable<Dictionary<string, object?>> Rows(string[] columns, object?[,] values)
        {
            for (var row = 0; row < values.GetLength(0); row++)
            {
                var result = new Dictionary<string, object?>(StringComparer.Ordinal);
                for (var column = 0; column < columns.Length; column++)
                {
                    result[columns[column]] = values[row, column];
                }

                yield return result;
            }
        }
    }
}
