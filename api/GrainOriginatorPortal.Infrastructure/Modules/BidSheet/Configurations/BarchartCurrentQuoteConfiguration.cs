// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BarchartCurrentQuote</c>.</summary>
public sealed class BarchartCurrentQuoteConfiguration : IEntityTypeConfiguration<BarchartCurrentQuote>
{
    public void Configure(EntityTypeBuilder<BarchartCurrentQuote> entity)
    {
        entity.ToTable("BarchartCurrentQuote", schema: "dbo");
        entity.HasKey(e => e.Symbol);
        entity.Property(e => e.Symbol).HasMaxLength(100).IsRequired();
        entity.Property(e => e.LastPrice).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.NetChange).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.PercentChange).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.OpenPrice).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.HighPrice).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.LowPrice).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.ClosePrice).HasPrecision(19, 4).IsRequired(false);
        entity.Property(e => e.UnitCode).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.DayCode).HasMaxLength(5).IsRequired(false);
        entity.Property(e => e.QuoteMode).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.QuoteFlag).HasMaxLength(5).IsRequired(false);
        entity.Property(e => e.TradeTimestamp).HasColumnType("datetime2(3)").IsRequired(false);
        entity.Property(e => e.ServerTimestamp).HasColumnType("datetime2(3)").IsRequired(false);
        entity.Property(e => e.UpdatedAtUtc).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        entity.HasIndex(e => e.TradeTimestamp).IsDescending().HasDatabaseName("IX_BarchartCurrentQuote_TradeTimestamp");
        // Shared-PK 1:1 with the catalog; no navigation property — reads go through raw SQL or the views.
        entity.HasOne<BarchartInstrument>()
              .WithOne()
              .HasForeignKey<BarchartCurrentQuote>(e => e.Symbol)
              .OnDelete(DeleteBehavior.Cascade)
              .HasConstraintName("FK_BarchartCurrentQuote_BarchartInstrument");
    }
}
