// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary>The <c>dbo.vw_BarchartLocation</c> view: one row per BarChart elevator, read-only.</summary>
public sealed class BarchartLocationSummaryConfiguration : IEntityTypeConfiguration<BarchartLocationSummary>
{
    public void Configure(EntityTypeBuilder<BarchartLocationSummary> entity)
    {
        entity.HasNoKey();
        entity.ToView("vw_BarchartLocation", schema: "dbo");
    }
}
