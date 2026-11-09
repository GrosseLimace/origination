// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BarchartQuoteSnapshot</c>.</summary>
public sealed class BarchartQuoteSnapshotConfiguration : IEntityTypeConfiguration<BarchartQuoteSnapshot>
{
    public void Configure(EntityTypeBuilder<BarchartQuoteSnapshot> entity)
    {
        entity.ToTable("BarchartQuoteSnapshot", schema: "dbo");
        // (SnapshotDate, Symbol) makes a same-day re-load replace rather than duplicate,
        // which is what lets the ingest endpoints be retried safely.
        entity.HasKey(e => new { e.SnapshotDate, e.Symbol });
        entity.Property(e => e.SnapshotDate).HasColumnType("date").IsRequired();
        entity.Property(e => e.Symbol).HasMaxLength(100).IsRequired();
        entity.Property(e => e.LastPrice).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.NetChange).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.TradeTimestamp).HasColumnType("datetime2(3)").IsRequired(false);
        entity.Property(e => e.CreatedAtUtc).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        entity.HasIndex(e => new { e.Symbol, e.SnapshotDate })
              .IsDescending(false, true)
              .HasDatabaseName("IX_BarchartQuoteSnapshot_Symbol_SnapshotDate");
        entity.HasOne<BarchartInstrument>()
              .WithMany()
              .HasForeignKey(e => e.Symbol)
              .OnDelete(DeleteBehavior.Cascade)
              .HasConstraintName("FK_BarchartQuoteSnapshot_BarchartInstrument");
    }
}
