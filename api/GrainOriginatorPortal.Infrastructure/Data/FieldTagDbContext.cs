using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// POC-only DbContext for the field-tagging feature, backed by a local SQLite file — deliberately
/// isolated from ApplicationDbContext / the shared dev Azure SQL database. Schema is created via
/// <c>Database.EnsureCreated()</c> at startup (see FieldTagsPocDependencyInjection), never via an
/// EF migration. Config-gated on FieldTags:LocalStorePath — see docs/maps/field-tagging/01-data-model.md.
/// </summary>
public class FieldTagDbContext : DbContext
{
    public FieldTagDbContext(DbContextOptions<FieldTagDbContext> options)
        : base(options)
    {
    }

    public DbSet<CustomerFieldTag> CustomerFieldTags => Set<CustomerFieldTag>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<CustomerFieldTag>(entity =>
        {
            entity.ToTable("CustomerFieldTags");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).IsRequired();
            entity.Property(e => e.SelectionMethod).HasMaxLength(10).IsRequired();
            entity.Property(e => e.GeometryJson).IsRequired();
            entity.Property(e => e.CalcAcres);
            entity.Property(e => e.ExternalRef).HasMaxLength(80).IsRequired();
            entity.Property(e => e.CdlYear).HasMaxLength(4);
            entity.Property(e => e.CdlSnapshotJson);
            entity.Property(e => e.CreatedBy).HasMaxLength(256).IsRequired();
            entity.Property(e => e.CreatedAt).IsRequired();
            entity.Property(e => e.ModifiedBy).HasMaxLength(256);
            entity.Property(e => e.ModifiedAt);
            entity.Property(e => e.IsDeleted).HasDefaultValue(false).IsRequired();
            entity.Property(e => e.DeletedAt);
            entity.Property(e => e.DeletedBy).HasMaxLength(256);

            // Every read path filters by CustomerId.
            entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_CustomerFieldTags_CustomerId");

            // Unique filtered index over active rows only — SQLite quoting ("IsDeleted" = 0), not
            // SQL Server bracket quoting. Soft-deleted rows keep their ExternalRef but drop out of
            // this index, so "delete tag → re-tag same field" can insert a fresh row.
            entity.HasIndex(e => new { e.CustomerId, e.ExternalRef })
                  .IsUnique()
                  .HasFilter("\"IsDeleted\" = 0")
                  .HasDatabaseName("UQ_CustomerFieldTags_CustomerId_ExternalRef");
        });
    }
}
