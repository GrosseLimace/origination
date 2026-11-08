// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BarchartApiCallAudit</c>.</summary>
public sealed class BarchartApiCallAuditConfiguration : IEntityTypeConfiguration<BarchartApiCallAudit>
{
    public void Configure(EntityTypeBuilder<BarchartApiCallAudit> entity)
    {
        entity.ToTable("BarchartApiCallAudit", schema: "dbo");
        entity.HasKey(e => e.ApiCallId);
        entity.Property(e => e.ApiCallId).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CalledAtUtc).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        entity.Property(e => e.Endpoint).HasMaxLength(100).IsRequired();
        entity.Property(e => e.QueryParams).HasMaxLength(2000).IsRequired(false);
        entity.Property(e => e.HttpStatus).IsRequired(false);
        entity.Property(e => e.Success).IsRequired();
        entity.Property(e => e.RowsAffected).IsRequired(false);
        entity.Property(e => e.DurationMs).IsRequired(false);
        entity.Property(e => e.ErrorMessage).HasMaxLength(2000).IsRequired(false);
        // Backs vw_BarchartMonthlyApiUsage and the pre-run budget check.
        entity.HasIndex(e => e.CalledAtUtc)
              .HasDatabaseName("IX_BarchartApiCallAudit_CalledAtUtc")
              .IncludeProperties(e => new { e.Endpoint, e.Success });
    }
}
