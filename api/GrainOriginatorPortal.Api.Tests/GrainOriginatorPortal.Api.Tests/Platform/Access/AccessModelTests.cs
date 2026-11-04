// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

/// <summary>
/// Keeps <c>dbo.Permissions</c> in step with <c>AppPermissions</c>, which seeds it. None of these tests
/// opens a connection: the SQL Server provider only builds the model and compares it with the migrations.
/// </summary>
public class AccessModelTests
{
    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlServer("Server=model-check.invalid;Database=ModelCheck;Integrated Security=true")
            .Options);

    [Fact]
    public void Model_HasNoChangesWithoutAMigration()
    {
        // Adding a permission to AppPermissions changes the HasData seed. Without a
        // migration, the new permission would never reach dbo.Permissions and no grant could name it.
        using var context = CreateContext();

        Assert.False(context.Database.HasPendingModelChanges(),
            "The EF model differs from the last migration. Run `dotnet ef migrations add` (see docs/operations).");
    }

    // Seed data lives only on the design-time model; the runtime model drops it.
    private static IEnumerable<IDictionary<string, object?>> PermissionSeedRows(ApplicationDbContext context) =>
        context.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(Permission))!.GetSeedData();

    [Fact]
    public void PermissionsSeed_IsTheCatalog()
    {
        using var context = CreateContext();
        var seeded = PermissionSeedRows(context)
            .Select(row => (Id: (string)row[nameof(Permission.Id)]!, Module: (string)row[nameof(Permission.ModuleId)]!))
            .OrderBy(p => p.Id, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(AppPermissions.All, seeded.Select(p => p.Id));
        Assert.All(seeded, p => Assert.Equal(AppPermissions.ModuleOf[p.Id], p.Module));
    }

    [Fact]
    public void PermissionsSeed_SplitsEachPermissionIntoItsParts()
    {
        using var context = CreateContext();
        var row = PermissionSeedRows(context)
            .Single(r => (string)r[nameof(Permission.Id)]! == AppPermissions.BidSheet.BidSheetLocationsDeleteGlobal);
        var unscoped = PermissionSeedRows(context)
            .Single(r => (string)r[nameof(Permission.Id)]! == AppPermissions.Engagement.NotesWrite);

        Assert.Equal(("bid-sheet-locations", "delete", "global"), ((string)row["Resource"]!, (string)row["Action"]!, (string)row["Scope"]!));
        Assert.Equal(("notes", "write", Permission.GlobalScope), ((string)unscoped["Resource"]!, (string)unscoped["Action"]!, (string)unscoped["Scope"]!));
    }
}
