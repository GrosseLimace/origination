// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Tests.Data;

/// <summary>
/// Asserts that ApplicationDbContextModelSnapshot still describes the same model as
/// OnModelCreating — i.e. that there are no un-migrated model changes.
///
/// This matters more here than in a typical repository. The dotnet-ef tool cannot be installed on
/// the machines this project is developed on (no NuGet sources are configured), so migrations, the
/// matching Designer file and the model snapshot are all written BY HAND. Nothing else catches a
/// snapshot that has drifted from the fluent configuration: the solution still compiles, the unit
/// suite still passes, and the mistake only surfaces when a deploy applies a migration whose DDL
/// does not match what the application then expects to query.
///
/// This is the check "dotnet ef migrations add" performs implicitly when it finds no changes to
/// scaffold, reimplemented against the same EF service that does it.
///
/// If this test fails, the snapshot and the fluent config disagree. Fix whichever is wrong — do
/// not delete the assertion.
///
/// No database is contacted. The connection string is never opened; SQL Server is registered only
/// so that relational type mappings (nvarchar(50), decimal(18,2), date) resolve the way they will
/// in production. An in-memory provider would not have relational metadata to compare at all.
/// </summary>
public class MigrationSnapshotConsistencyTests
{
    private static ApplicationDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlServer("Server=(localdb)\\never-connected;Database=ModelOnly;")
            .Options;

        return new ApplicationDbContext(options);
    }

    [Fact]
    public void ThereAreNoUnmigratedModelChanges()
    {
        using var context = CreateContext();

        // The same comparison "dotnet ef migrations add" runs before deciding whether it has
        // anything to scaffold. True here means OnModelCreating describes something the snapshot
        // does not — a column, index, key or constraint that no migration will ever create.
        Assert.False(
            context.Database.HasPendingModelChanges(),
            "ApplicationDbContextModelSnapshot has drifted from OnModelCreating. Because migrations "
            + "are hand-written in this repository, this will NOT be caught anywhere else — the "
            + "build and the rest of the suite pass either way, and the mismatch surfaces only once "
            + "a deploy has applied DDL that disagrees with what the app queries.");
    }

    [Theory]
    [InlineData("OrganicCertification")]
    [InlineData("OrganicCertificationScope")]
    [InlineData("OrganicCertificationItem")]
    [InlineData("OrganicCertificationLoad")]
    public void OrganicCertificationTablesAreMappedToDbo(string tableName)
    {
        // The four certification landing tables. Every other DbSet in this context is dbo, and the
        // ingest endpoint writes by EF rather than by raw SQL, so a table landing in the wrong
        // schema would fail at runtime rather than at build.
        using var context = CreateContext();

        var entityType = context.Model.GetEntityTypes()
            .SingleOrDefault(e => e.GetTableName() == tableName);

        Assert.NotNull(entityType);
        Assert.Equal("dbo", entityType!.GetSchema());
    }

    [Fact]
    public void CertificationJoinKeyIsUniqueOnNopid()
    {
        // The whole read design rests on NOP id being one row: Customer.NopIdNumber resolves to
        // exactly one OrganicCertification, which is what lets several customer records share one
        // certificate without a junction table. It is also the ingest upsert key — without the
        // unique index a re-sent message would insert a duplicate instead of updating.
        using var context = CreateContext();

        var entityType = context.Model.GetEntityTypes()
            .Single(e => e.GetTableName() == "OrganicCertification");

        var index = entityType.GetIndexes()
            .SingleOrDefault(i => i.Properties.Count == 1 && i.Properties[0].Name == "Nopid");

        Assert.NotNull(index);
        Assert.True(index!.IsUnique, "Nopid must be uniquely indexed — it is the upsert key.");
    }

    /// <summary>
    /// Locates a file under the repository by walking up from the test assembly. Needed because
    /// the only way to check hand-written migration DDL is to read it.
    /// </summary>
    private static string ReadRepoFile(string relativePath)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, relativePath)))
        {
            dir = dir.Parent;
        }

        Assert.True(dir is not null, $"Could not find {relativePath} walking up from {AppContext.BaseDirectory}");
        return File.ReadAllText(Path.Combine(dir!.FullName, relativePath));
    }

    [Fact]
    public void TheCertificationMigrationPointsItsCustomerForeignKeyAtTheRightColumn()
    {
        // THIS IS THE GAP THAT BIT US. ThereAreNoUnmigratedModelChanges compares the MODEL to the
        // SNAPSHOT — both generated from the same fluent config, so both agreed — while the
        // migration DDL is hand-written here (dotnet-ef cannot be installed) and nothing checked
        // it against either. The first Dev deploy failed with:
        //
        //   Foreign key 'FK_OrganicCertification_Customer' references invalid column 'Id' in
        //   referenced table 'dbo.Customer'.
        //
        // Customer's property is named Id but maps to the CustomerId column, and the migration
        // said "Id". Every other migration in the repo that points at Customer gets this right.
        //
        // The expected value is DERIVED FROM THE MODEL rather than hardcoded, so if that mapping
        // ever changes this test follows it instead of enforcing a stale constant.
        using var context = CreateContext();

        var customerKeyColumn = context.Model
            .GetEntityTypes()
            .Single(e => e.GetTableName() == "Customer")
            .FindPrimaryKey()!
            .Properties
            .Single()
            .GetColumnName();

        Assert.Equal("CustomerId", customerKeyColumn);   // the mapping this migration relies on

        var migration = ReadRepoFile(Path.Combine(
            "api", "GrainOriginatorPortal.Infrastructure", "Data", "Migrations",
            "20260923152000_AddOrganicCertificationTables.cs"));

        // Scoped to the Customer foreign key specifically. A blanket ban on principalColumn: "Id"
        // would be wrong — the two child tables point at OrganicCertification, whose key column
        // genuinely IS "Id". The mistake was only ever about which column Customer uses.
        var customerFk = migration.IndexOf("principalTable: \"Customer\"", StringComparison.Ordinal);
        Assert.True(customerFk >= 0, "The migration no longer has a foreign key to Customer.");

        var columnLine = migration.IndexOf("principalColumn:", customerFk, StringComparison.Ordinal);
        Assert.True(columnLine >= 0, "The Customer foreign key declares no principalColumn.");

        var declared = migration.Substring(columnLine, Math.Min(60, migration.Length - columnLine));
        Assert.Contains($"principalColumn: \"{customerKeyColumn}\"", declared);
    }

    [Fact]
    public void CertificationDoesNotStoreContactPii()
    {
        // The source payload carries contactFirstName, contactLastName, phone and email. They are
        // deliberately not persisted: nothing displays them, and carrying contact PII here would
        // oblige the read endpoint to be trade-unit scoped the way ProducerDetails is, reversing a
        // decision the business has already approved. If a future change genuinely needs them,
        // delete this test in the same commit that adds the columns — and revisit the scoping.
        using var context = CreateContext();

        var propertyNames = context.Model.GetEntityTypes()
            .Single(e => e.GetTableName() == "OrganicCertification")
            .GetProperties()
            .Select(p => p.Name)
            .ToList();

        Assert.DoesNotContain("ContactFirstName", propertyNames);
        Assert.DoesNotContain("ContactLastName", propertyNames);
        Assert.DoesNotContain("Phone", propertyNames);
        Assert.DoesNotContain("Email", propertyNames);
    }
}
