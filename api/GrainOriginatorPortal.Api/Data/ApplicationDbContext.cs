using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Data;

/// <summary>
/// DbContext for app-specific tables in the Origination database.
/// Separate from OriginationDbContext which connects to the ODS (read-only) database.
/// Tables here are owned by this application and support read/write operations.
/// </summary>
public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    public DbSet<Note> Notes => Set<Note>();
    public DbSet<ProducerDetails> ProducerDetails => Set<ProducerDetails>();
    public DbSet<PlantingIntention> PlantingIntentions => Set<PlantingIntention>();
    public DbSet<TradeUnit> TradeUnits => Set<TradeUnit>();
    public DbSet<TradeUnitGroup> TradeUnitGroups => Set<TradeUnitGroup>();
    public DbSet<GroupTradeUnit> GroupTradeUnits => Set<GroupTradeUnit>();
    public DbSet<Commodity> Commodities => Set<Commodity>();
    public DbSet<DashboardPlantingEstimate> DashboardPlantingEstimates => Set<DashboardPlantingEstimate>();
    public DbSet<DashboardMarketShare> DashboardMarketShares => Set<DashboardMarketShare>();
    public DbSet<DashboardActualHarvest> DashboardActualHarvests => Set<DashboardActualHarvest>();
    public DbSet<SavedList> SavedLists => Set<SavedList>();
    public DbSet<ESignEnrollment> ESignEnrollments => Set<ESignEnrollment>();
    public DbSet<CustomerSnapshot> CustomerSnapshots => Set<CustomerSnapshot>();
    public DbSet<UserPreference> UserPreferences => Set<UserPreference>();
    public DbSet<BidSheetEntry> BidSheetEntries => Set<BidSheetEntry>();
    public DbSet<BidReference> BidReferences => Set<BidReference>();
    public DbSet<ElevatorCache> ElevatorCaches => Set<ElevatorCache>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<TradeUnit>(entity =>
        {
            entity.ToTable("TradeUnits", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Code).HasColumnName("Code").HasMaxLength(100).IsRequired();
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();

            entity.HasIndex(e => e.Code).IsUnique().HasDatabaseName("IX_TradeUnits_Code");
        });

        modelBuilder.Entity<TradeUnitGroup>(entity =>
        {
            entity.ToTable("TradeUnitGroups", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.GroupName).HasColumnName("GroupName").HasMaxLength(100).IsRequired();
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
            entity.HasMany(e => e.TradeUnits).WithOne().HasForeignKey(tu => tu.GroupId);
        });

        modelBuilder.Entity<GroupTradeUnit>(entity =>
        {
            entity.ToTable("GroupTradeUnits", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.GroupId).HasColumnName("GroupId").IsRequired();
            entity.Property(e => e.TradeUnitCode).HasColumnName("TradeUnitCode").HasMaxLength(100).IsRequired();
            entity.Property(e => e.Location).HasColumnName("Location").HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
            entity.HasIndex(e => e.TradeUnitCode).HasDatabaseName("IX_GroupTradeUnits_TradeUnitCode");
        });

        modelBuilder.Entity<Commodity>(entity =>
        {
            entity.ToTable("Commodities", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Code).HasColumnName("Code").HasMaxLength(100).IsRequired();
            entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Category).HasColumnName("Category").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();

            entity.HasIndex(e => e.Code).IsUnique().HasDatabaseName("IX_Commodities_Code");
        });

        modelBuilder.Entity<Note>(entity =>
        {
            entity.ToTable("Notes", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(200).IsRequired();
            entity.Property(e => e.CustomerCode).HasColumnName("CustomerCode").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Description).HasColumnName("Description").HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(200).IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.IsPinned).HasColumnName("IsPinned").HasDefaultValue(false).IsRequired();

            entity.Ignore(e => e.Content);

            entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_Notes_CustomerId");
        });

        modelBuilder.Entity<PlantingIntention>(entity =>
        {
            entity.ToTable("ProducerPlantingIntentions", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(255).IsRequired();
            entity.Property(e => e.CustomerCode).HasColumnName("CustomerCode").HasMaxLength(50).IsRequired();
            entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired();
            entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
            entity.Property(e => e.Crop).HasColumnName("Crop").HasMaxLength(100).IsRequired();
            entity.Property(e => e.Type).HasColumnName("Type").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Description).HasColumnName("Description").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.Acres).HasColumnName("Acres").IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);

            entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_ProducerPlantingIntentions_CustomerId");
            entity.HasIndex(e => new { e.TradeUnit, e.PlantingYear }).HasDatabaseName("IX_ProducerPlantingIntentions_TradeUnit");
        });

        modelBuilder.Entity<DashboardPlantingEstimate>(entity =>
        {
            entity.ToTable("DashboardPlantingEstimates", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.TradeUnitKey).HasColumnName("TradeUnitKey").HasMaxLength(500).IsRequired();
            entity.Property(e => e.Crop).HasColumnName("Crop").HasMaxLength(100).IsRequired();
            entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
            entity.Property(e => e.YieldEstimate).HasColumnName("YieldEstimate").HasColumnType("decimal(10,2)").IsRequired(false);
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
            entity.HasIndex(e => new { e.TradeUnitKey, e.Crop, e.PlantingYear }).IsUnique()
                .HasDatabaseName("UQ_DashboardPlantingEstimates_TradeUnitKey_Crop_PlantingYear");
        });

        modelBuilder.Entity<DashboardMarketShare>(entity =>
        {
            entity.ToTable("DashboardMarketShares", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.TradeUnitKey).HasColumnName("TradeUnitKey").HasMaxLength(500).IsRequired();
            entity.Property(e => e.CropCategory).HasColumnName("CropCategory").HasMaxLength(100).IsRequired();
            entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
            entity.Property(e => e.MarketSharePct).HasColumnName("MarketSharePct").HasColumnType("decimal(5,2)").IsRequired(false);
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
            entity.HasIndex(e => new { e.TradeUnitKey, e.CropCategory, e.PlantingYear }).IsUnique()
                .HasDatabaseName("UQ_DashboardMarketShares_TradeUnitKey_CropCategory_PlantingYear");
        });

        modelBuilder.Entity<DashboardActualHarvest>(entity =>
        {
            entity.ToTable("DashboardActualHarvests", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.TradeUnitKey).HasColumnName("TradeUnitKey").HasMaxLength(500).IsRequired();
            entity.Property(e => e.CropCategory).HasColumnName("CropCategory").HasMaxLength(100).IsRequired();
            entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
            entity.Property(e => e.Bushels).HasColumnName("Bushels").IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
            entity.HasIndex(e => new { e.TradeUnitKey, e.PlantingYear }).HasDatabaseName("IX_DashboardActualHarvests_TradeUnitKey_PlantingYear");
        });

        modelBuilder.Entity<SavedList>(entity =>
        {
            entity.ToTable("SavedLists", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(100).IsRequired();
            entity.Property(e => e.Query).HasColumnName("Query").HasMaxLength(500).IsRequired();
            entity.Property(e => e.TradeUnits).HasColumnName("TradeUnits").HasMaxLength(500).IsRequired(false);
            entity.Property(e => e.Filters).HasColumnName("Filters").HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
        });

        modelBuilder.Entity<ESignEnrollment>(entity =>
        {
            entity.ToTable("ESignEnrollment", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerCode).HasColumnName("CustomerCode").HasMaxLength(50).IsRequired();
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ESignEnabled).HasColumnName("eSignEnabled").IsRequired();
            entity.Property(e => e.ScoularViewRecipients).HasColumnName("ScoularViewRecipients").IsRequired(false);
            entity.Property(e => e.Guild).HasColumnName("GUID").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.UpdatedOn).HasColumnName("UpdatedOn").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.HasIndex(e => e.CustomerCode).IsUnique().HasDatabaseName("UQ_eSignEnrollment_CustomerCode");
        });

        modelBuilder.Entity<ProducerDetails>(entity =>
        {
            entity.ToTable("ProducerDetails", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.SourceCustomerId).HasColumnName("SourceCustomerId").HasMaxLength(400).IsRequired(false);
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(255).IsRequired();
            entity.Property(e => e.TotalAcres).HasColumnName("TotalAcres").HasColumnType("decimal(18,2)").IsRequired(false);
            entity.Property(e => e.BinCapacity).HasColumnName("BinCapacity").HasColumnType("decimal(18,2)").IsRequired(false);
            entity.Property(e => e.PrimaryContact).HasColumnName("PrimaryContact").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.Commodities).HasColumnName("Commodities").HasMaxLength(1000).IsRequired(false);
            entity.Property(e => e.LinkedProducerIds).HasColumnName("LinkedProducerIds").HasMaxLength(1000).IsRequired(false);
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);

            entity.HasIndex(e => e.CustomerId).IsUnique().HasDatabaseName("IX_ProducerDetails_CustomerId");
        });

        modelBuilder.Entity<CustomerSnapshot>(entity =>
        {
            entity.ToTable("CustomerSnapshot", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(500).IsRequired();
            entity.Property(e => e.SourceCustomerId).HasColumnName("SourceCustomerId").HasMaxLength(400).IsRequired(false);
            entity.Property(e => e.IndustryCode1).HasColumnName("IndustryCode1").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.SnapshotRefreshedAt).HasColumnName("SnapshotRefreshedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        });

        modelBuilder.Entity<UserPreference>(entity =>
        {
            entity.ToTable("UserPreferences", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.UserId).HasColumnName("UserId").HasMaxLength(256).IsRequired();
            entity.Property(e => e.SelectedGroupNames).HasColumnName("SelectedGroupNames").HasMaxLength(2000).HasDefaultValue("[]").IsRequired();
            entity.Property(e => e.SelectedTradeUnits).HasColumnName("SelectedTradeUnits").HasMaxLength(2000).HasDefaultValue("[]").IsRequired();
            entity.Property(e => e.UpdatedAt).HasColumnName("UpdatedAt").IsRequired();
            entity.HasIndex(e => e.UserId).IsUnique().HasDatabaseName("UQ_UserPreferences_UserId");
        });

        modelBuilder.Entity<ElevatorCache>(entity =>
        {
            entity.ToTable("ElevatorCache", schema: "dbo");
            entity.HasKey(e => e.ElevatorCode);
            entity.Property(e => e.ElevatorCode).HasColumnName("ElevatorCode").HasMaxLength(50).IsRequired();
            entity.Property(e => e.ElevatorShortName).HasColumnName("ElevatorShortName").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.ElevatorName).HasColumnName("ElevatorName").HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.Address).HasColumnName("Address").HasMaxLength(300).IsRequired(false);
            entity.Property(e => e.City).HasColumnName("City").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.State).HasColumnName("State").HasMaxLength(10).IsRequired(false);
            entity.Property(e => e.ZipCode).HasColumnName("ZipCode").HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.OurFacility).HasColumnName("OurFacility").HasMaxLength(1).IsRequired(false);
            entity.Property(e => e.TradeUnitCode).HasColumnName("TradeUnitCode").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.Latitude).HasColumnName("Latitude").IsRequired(false);
            entity.Property(e => e.Longitude).HasColumnName("Longitude").IsRequired(false);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
            entity.Property(e => e.LastRefreshedAt).HasColumnName("LastRefreshedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.HasIndex(e => e.TradeUnitCode).HasDatabaseName("IX_ElevatorCache_TradeUnitCode");
        });

        modelBuilder.Entity<BidSheetEntry>(entity =>
        {
            entity.ToTable("BidSheetEntries", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(200).IsRequired();
            entity.Property(e => e.Address).HasColumnName("Address").HasMaxLength(300).IsRequired(false);
            entity.Property(e => e.City).HasColumnName("City").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.State).HasColumnName("State").HasMaxLength(10).IsRequired(false);
            entity.Property(e => e.Latitude).HasColumnName("Latitude").IsRequired(false);
            entity.Property(e => e.Longitude).HasColumnName("Longitude").IsRequired(false);
            entity.Property(e => e.ElevatorCode).HasColumnName("ElevatorCode").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.TradeUnitCode).HasColumnName("TradeUnitCode").HasMaxLength(100).IsRequired();
            entity.Property(e => e.CommodityCode).HasColumnName("CommodityCode").HasMaxLength(50).IsRequired();
            entity.Property(e => e.CropYear).HasColumnName("CropYear").IsRequired();
            entity.Property(e => e.Bid).HasColumnName("Bid").HasMaxLength(50).IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.HasIndex(e => new { e.TradeUnitCode, e.CropYear, e.CommodityCode }).HasDatabaseName("IX_BidSheetEntries_TradeUnit_Year");
        });

        modelBuilder.Entity<BidReference>(entity =>
        {
            entity.ToTable("BidReferences", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.UserId).HasColumnName("UserId").HasMaxLength(256).IsRequired();
            entity.Property(e => e.TradeUnitCode).HasColumnName("TradeUnitCode").HasMaxLength(100).IsRequired();
            entity.Property(e => e.CommodityCode).HasColumnName("CommodityCode").HasMaxLength(50).IsRequired();
            entity.Property(e => e.ElevatorCode).HasColumnName("ElevatorCode").HasMaxLength(50).IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.HasIndex(e => new { e.UserId, e.TradeUnitCode, e.CommodityCode }).IsUnique().HasDatabaseName("UQ_BidReferences_User_TradeUnit_Commodity");
        });
    }
}
