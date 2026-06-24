using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Data;

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
    public DbSet<Commodity> Commodities => Set<Commodity>();
    public DbSet<DashboardPlantingEstimate> DashboardPlantingEstimates => Set<DashboardPlantingEstimate>();
    public DbSet<DashboardMarketShare> DashboardMarketShares => Set<DashboardMarketShare>();
    public DbSet<DashboardActualHarvest> DashboardActualHarvests => Set<DashboardActualHarvest>();
    public DbSet<SavedList> SavedLists => Set<SavedList>();
    public DbSet<ESignEnrollment> ESignEnrollments => Set<ESignEnrollment>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<CustomerTradeUnit> CustomerTradeUnits => Set<CustomerTradeUnit>();
    public DbSet<CustomerLink> CustomerLinks => Set<CustomerLink>();
    public DbSet<CustomerCommodity> CustomerCommodities => Set<CustomerCommodity>();
    public DbSet<ProducerGrainOnFarm> ProducerGrainOnFarm => Set<ProducerGrainOnFarm>();
    public DbSet<UserPreference> UserPreferences => Set<UserPreference>();
    public DbSet<BidSheetLocation> BidSheetLocations => Set<BidSheetLocation>();
    public DbSet<BidSheetLocationBid> BidSheetLocationBids => Set<BidSheetLocationBid>();
    public DbSet<BidSheetLocationOrder> BidSheetLocationOrders => Set<BidSheetLocationOrder>();
    public DbSet<BidSheetPreference> BidSheetPreferences => Set<BidSheetPreference>();
    public DbSet<ElevatorCache> ElevatorCaches => Set<ElevatorCache>();
    public DbSet<HarvestWindow> HarvestWindows => Set<HarvestWindow>();
    public DbSet<UserActivity> UserActivities => Set<UserActivity>();
    public DbSet<UserClickEvent> UserClickEvents => Set<UserClickEvent>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<UserActivityDaily> UserActivityDailies => Set<UserActivityDaily>();
    public DbSet<FeatureUsageDaily> FeatureUsageDailies => Set<FeatureUsageDaily>();
    public DbSet<WeeklyLoginAggregate> WeeklyLoginAggregates => Set<WeeklyLoginAggregate>();
    public DbSet<UserTradeUnitSnapshot> UserTradeUnitSnapshots => Set<UserTradeUnitSnapshot>();
    public DbSet<QueryLibraryItem> QueryLibrary => Set<QueryLibraryItem>();
    public DbSet<QuerySearchLog> QuerySearchLogs => Set<QuerySearchLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Commodity>(entity =>
        {
            entity.ToTable("Commodities", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Code).HasColumnName("Code").HasMaxLength(100).IsRequired();
            entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Category).HasColumnName("Category").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Tier1).HasColumnName("Tier1").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Tier2).HasColumnName("Tier2").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Tier3).HasColumnName("Tier3").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.BaseUOM).HasColumnName("BaseUOM").HasMaxLength(10).IsRequired(false);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
            entity.Property(e => e.ShowInPlantingIntentions).HasColumnName("ShowInPlantingIntentions").HasDefaultValue(false).IsRequired();

            entity.HasIndex(e => e.Code).IsUnique().HasDatabaseName("IX_Commodities_Code");
        });

        modelBuilder.Entity<Note>(entity =>
        {
            entity.ToTable("Notes", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            // CustomerName / CustomerCode dropped from the DB (Phase 3b) — they live
            // on the DTO for API contract stability, populated from the Customer FK
            // join on reads. .Ignore() keeps EF from trying to read/write the columns.
            entity.Ignore(e => e.CustomerName);
            entity.Ignore(e => e.CustomerCode);
            entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Description).HasColumnName("Description").HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(200).IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.IsPinned).HasColumnName("IsPinned").HasDefaultValue(false).IsRequired();
            entity.Property(e => e.IsDeleted).HasColumnName("IsDeleted").HasDefaultValue(false).IsRequired();
            entity.Property(e => e.DeletedAt).HasColumnName("DeletedAt").IsRequired(false);
            entity.Property(e => e.DeletedBy).HasColumnName("DeletedBy").HasMaxLength(200).IsRequired(false);

            entity.Ignore(e => e.Content);

            // FK to dbo.Customer — NoAction so cascading deletes from Customer don't
            // wipe user-authored notes. The populate endpoint disables this constraint
            // temporarily while it rebuilds the Customer table.
            entity.HasOne(e => e.Customer)
                  .WithMany()
                  .HasForeignKey(e => e.CustomerId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_Notes_Customer_CustomerId");

            entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_Notes_CustomerId");
        });

        modelBuilder.Entity<PlantingIntention>(entity =>
        {
            entity.ToTable("ProducerPlantingIntentions", schema: "dbo");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            // CustomerName / CustomerCode dropped from the DB (Phase 3b) — populated
            // from the Customer FK join on reads.
            entity.Ignore(e => e.CustomerName);
            entity.Ignore(e => e.CustomerCode);
            entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired();
            entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
            entity.Property(e => e.Crop).HasColumnName("Crop").HasMaxLength(100).IsRequired();
            entity.Property(e => e.Category).HasColumnName("Category").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Type).HasColumnName("Type").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Description).HasColumnName("Description").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.Acres).HasColumnName("Acres").IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);

            // FK to dbo.Customer — NoAction so cascading deletes from Customer don't
            // wipe user-authored planting intentions.
            entity.HasOne(e => e.Customer)
                  .WithMany()
                  .HasForeignKey(e => e.CustomerId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_ProducerPlantingIntentions_Customer_CustomerId");

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
            entity.Property(e => e.IncludedCustomerIds).HasColumnName("IncludedCustomerIds").HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(e => e.ExcludedCustomerIds).HasColumnName("ExcludedCustomerIds").HasColumnType("nvarchar(max)").IsRequired(false);
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
            // ScoularId / CustomerName / LinkedProducerIds dropped from the DB
            // (Phase 3b). ScoularId + CustomerName come from the Customer FK join.
            // LinkedProducerIds is composed server-side from dbo.CustomerLink on read.
            entity.Ignore(e => e.ScoularId);
            entity.Ignore(e => e.CustomerName);
            entity.Ignore(e => e.LinkedProducerIds);
            entity.Property(e => e.TotalAcres).HasColumnName("TotalAcres").HasColumnType("decimal(18,2)").IsRequired(false);
            entity.Property(e => e.BinCapacity).HasColumnName("BinCapacity").HasColumnType("decimal(18,2)").IsRequired(false);
            entity.Property(e => e.PrimaryContact).HasColumnName("PrimaryContact").HasMaxLength(255).IsRequired(false);
            // Commodities is composed server-side from dbo.CustomerCommodity on read
            // (Phase 4b). The column was dropped from dbo.ProducerDetails; the property
            // stays on the DTO for API contract stability.
            entity.Ignore(e => e.Commodities);
            // GrainOnFarm is composed server-side from dbo.ProducerGrainOnFarm on read / rebuilt on upsert.
            entity.Ignore(e => e.GrainOnFarm);
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);

            // FK to dbo.Customer — NoAction so cascading deletes from Customer don't
            // wipe rep-authored producer details. UNIQUE index on CustomerId enforces
            // the 1:1 relationship.
            entity.HasOne(e => e.Customer)
                  .WithMany()
                  .HasForeignKey(e => e.CustomerId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_ProducerDetails_Customer_CustomerId");

            entity.HasIndex(e => e.CustomerId).IsUnique().HasDatabaseName("IX_ProducerDetails_CustomerId");
        });

        modelBuilder.Entity<CustomerLink>(entity =>
        {
            entity.ToTable("CustomerLink", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.FromCustomerId).HasColumnName("FromCustomerId").IsRequired();
            entity.Property(e => e.ToCustomerId).HasColumnName("ToCustomerId").IsRequired();

            entity.HasOne(e => e.FromCustomer)
                  .WithMany()
                  .HasForeignKey(e => e.FromCustomerId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_CustomerLink_Customer_From");
            entity.HasOne(e => e.ToCustomer)
                  .WithMany()
                  .HasForeignKey(e => e.ToCustomerId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_CustomerLink_Customer_To");

            // One row per directed pair.
            entity.HasIndex(e => new { e.FromCustomerId, e.ToCustomerId })
                  .IsUnique()
                  .HasDatabaseName("UQ_CustomerLink_From_To");
            // Reverse-lookup index — "who links TO this customer?"
            entity.HasIndex(e => e.ToCustomerId).HasDatabaseName("IX_CustomerLink_ToCustomerId");
        });

        modelBuilder.Entity<CustomerCommodity>(entity =>
        {
            entity.ToTable("CustomerCommodity", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.CommodityId).HasColumnName("CommodityId").IsRequired();

            entity.HasOne(e => e.Customer)
                  .WithMany()
                  .HasForeignKey(e => e.CustomerId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_CustomerCommodity_Customer");
            entity.HasOne(e => e.Commodity)
                  .WithMany()
                  .HasForeignKey(e => e.CommodityId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_CustomerCommodity_Commodity");

            // One row per (customer, commodity) — duplicates make no sense.
            entity.HasIndex(e => new { e.CustomerId, e.CommodityId })
                  .IsUnique()
                  .HasDatabaseName("UQ_CustomerCommodity_Customer_Commodity");
            // Reverse-lookup index — "which customers grow commodity X?"
            entity.HasIndex(e => e.CommodityId).HasDatabaseName("IX_CustomerCommodity_CommodityId");
        });

        modelBuilder.Entity<ProducerGrainOnFarm>(entity =>
        {
            entity.ToTable("ProducerGrainOnFarm", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.CommodityGroup).HasColumnName("CommodityGroup").HasMaxLength(100).IsRequired();
            entity.Property(e => e.BushelsOnHand).HasColumnName("BushelsOnHand").HasColumnType("decimal(18,2)").IsRequired(false);
            entity.Property(e => e.TargetBushels).HasColumnName("TargetBushels").HasColumnType("decimal(18,2)").IsRequired(false);

            entity.HasOne(e => e.Customer)
                  .WithMany()
                  .HasForeignKey(e => e.CustomerId)
                  .OnDelete(DeleteBehavior.NoAction)
                  .HasConstraintName("FK_ProducerGrainOnFarm_Customer");

            // One row per (customer, commodity group).
            entity.HasIndex(e => new { e.CustomerId, e.CommodityGroup })
                  .IsUnique()
                  .HasDatabaseName("UQ_ProducerGrainOnFarm_Customer_Group");
        });

        // -------------------------------------------------------------------------
        // Customer + CustomerTradeUnit — normalized customer schema.
        // Customer holds one row per ODS CustomerId (attribute columns); CustomerTradeUnit
        // holds one row per (CustomerId, TradeUnit) membership.
        // -------------------------------------------------------------------------
        modelBuilder.Entity<Customer>(entity =>
        {
            entity.ToTable("Customer", schema: "dbo");
            entity.HasKey(e => e.Id);

            // Id is the ODS CustomerId — not auto-generated; provided by sync.
            entity.Property(e => e.Id).HasColumnName("CustomerId").ValueGeneratedNever().IsRequired();
            entity.Property(e => e.Name).HasColumnName("CustomerName").HasMaxLength(500).IsRequired();
            // Trim on read — ODS source columns are CHAR-padded; without trimming, comparisons
            // against Note.CustomerCode / Contract.SourceContractId (which both use Trim conversion)
            // silently fail. Matches the pattern used in OriginationDbContext for similar columns.
            entity.Property(e => e.ScoularId).HasColumnName("ScoularId").HasMaxLength(400).IsRequired(false)
                  .HasConversion(v => v, v => v != null ? v.Trim() : v);
            entity.Property(e => e.IndustryCode1).HasColumnName("IndustryCode1").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
            entity.Property(e => e.IsManual).HasColumnName("IsManual").HasDefaultValue(false).IsRequired();
            entity.Property(e => e.EffectiveStartDate).HasColumnName("EffectiveStartDate").IsRequired(false);
            entity.Property(e => e.EffectiveEndDate).HasColumnName("EffectiveEndDate").IsRequired(false);

            // Contact columns — column names mirror the ODS source view for consistency.
            entity.Property(e => e.Phone).HasColumnName("MerchandisingPhone").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Email).HasColumnName("MerchandisingEmail").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedPrimaryPhone).HasColumnName("ExtendedPrimaryPhone").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.SupplementalEmail).HasColumnName("SupplementalEmail").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.Location).HasColumnName("MerchandisingCity").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.StateProvince).HasColumnName("MerchandisingStateProvince").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.AddressLine1).HasColumnName("MerchandisingAddressLine1").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.PostalCode).HasColumnName("MerchandisingPostalCode").HasMaxLength(20).IsRequired(false);

            // Extended address fields — more accurate location data for geocoding.
            entity.Property(e => e.ExtendedAddressLine1).HasColumnName("ExtendedAddressLine1").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedAddressLine2).HasColumnName("ExtendedAddressLine2").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedAddressLine3).HasColumnName("ExtendedAddressLine3").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedAddressLine4).HasColumnName("ExtendedAddressLine4").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedCity).HasColumnName("ExtendedCity").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedPostalCode).HasColumnName("ExtendedPostalCode").HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.ExtendedStateProvince).HasColumnName("ExtendedStateProvince").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.ExtendedCountry).HasColumnName("ExtendedCountry").HasMaxLength(255).IsRequired(false);

            // DTO-only fields — populated by service layer enrichment, not stored on the table.
            entity.Ignore(e => e.CustomerCode);
            entity.Ignore(e => e.Farm);
            entity.Ignore(e => e.TotalAcres);
            entity.Ignore(e => e.ESignEnabled);
            entity.Ignore(e => e.ScoularViewRecipients);
            entity.Ignore(e => e.Guild);
            entity.Ignore(e => e.Coordinates);
            entity.Ignore(e => e.FarmIds);
            entity.Ignore(e => e.LinkedProducerIds);

            entity.HasIndex(e => e.Name).HasDatabaseName("IX_Customer_CustomerName");
            entity.HasIndex(e => e.ScoularId).HasDatabaseName("IX_Customer_ScoularId");
        });

        modelBuilder.Entity<CustomerTradeUnit>(entity =>
        {
            entity.ToTable("CustomerTradeUnit", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired();
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
            entity.Property(e => e.IsManual).HasColumnName("IsManual").HasDefaultValue(false).IsRequired();
            // Additive flag (default false) — see CustomerTradeUnit.UserDeactivated. No-op for
            // existing rows; only set when a user removes a dormant sync-sourced membership.
            entity.Property(e => e.UserDeactivated).HasColumnName("UserDeactivated").HasDefaultValue(false).IsRequired();

            // Audit columns — same convention as Notes/ProducerDetails/Dashboard*. CreatedAt
            // defaults to GETUTCDATE() at the DB; CreatedBy is required; Modified* are nullable.
            // The nightly sync writes "system"; manual user actions write the acting user's UPN.
            entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
            entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);

            // FK to Customer.Id (the ODS CustomerId surrogate).
            entity.HasOne(e => e.Customer)
                  .WithMany()
                  .HasForeignKey(e => e.CustomerId)
                  .OnDelete(DeleteBehavior.Cascade);

            // One row per (customer, trade-unit) pair.
            entity.HasIndex(e => new { e.CustomerId, e.TradeUnit })
                  .IsUnique()
                  .HasDatabaseName("UQ_CustomerTradeUnit_CustomerId_TradeUnit");

            // Covering scope index — main TU-filtered query: WHERE TradeUnit IN (...) AND IsActive = 1.
            entity.HasIndex(e => new { e.TradeUnit, e.IsActive })
                  .HasDatabaseName("IX_CustomerTradeUnit_TradeUnit_IsActive");
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

        modelBuilder.Entity<BidSheetLocation>(entity =>
        {
            entity.ToTable("BidSheetLocations", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Address).HasMaxLength(300).IsRequired(false);
            entity.Property(e => e.City).HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.State).HasMaxLength(10).IsRequired(false);
            entity.Property(e => e.Latitude).IsRequired(false);
            entity.Property(e => e.Longitude).IsRequired(false);
            entity.Property(e => e.ElevatorCode).HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.TradeUnitCode).HasMaxLength(100).IsRequired();
            entity.Property(e => e.GroupName).HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.IsScoularFacility).HasDefaultValue(false).IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedBy).HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ModifiedAt).IsRequired(false);
            entity.HasIndex(e => e.TradeUnitCode).HasDatabaseName("IX_BidSheetLocations_TradeUnitCode");
            entity.HasMany(e => e.Bids).WithOne(b => b.Location).HasForeignKey(b => b.LocationId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BidSheetLocationBid>(entity =>
        {
            entity.ToTable("BidSheetLocationBids", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.LocationId).IsRequired();
            entity.Property(e => e.CommodityCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.CommodityName).HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.CommodityCategory).HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.CropYear).IsRequired();
            entity.Property(e => e.Month).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.Bid).HasMaxLength(50).IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.ModifiedBy).HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ModifiedAt).IsRequired(false);
            entity.HasIndex(e => new { e.LocationId, e.CommodityCode, e.CropYear, e.Month }).IsUnique().HasDatabaseName("UQ_BidSheetLocationBids_Location_Commodity_Year_Month");
        });

        modelBuilder.Entity<BidSheetLocationOrder>(entity =>
        {
            entity.ToTable("BidSheetLocationOrders", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.TradeUnitKey).HasMaxLength(500).IsRequired();
            entity.Property(e => e.LocationOrder).HasColumnType("nvarchar(max)").HasDefaultValue("[]").IsRequired();
            entity.Property(e => e.ModifiedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.HasIndex(e => new { e.UserId, e.TradeUnitKey }).IsUnique().HasDatabaseName("UQ_BidSheetLocationOrders_User_TradeUnitKey");
            entity.HasIndex(e => e.UserId).HasDatabaseName("IX_BidSheetLocationOrders_UserId");
        });

        modelBuilder.Entity<BidSheetPreference>(entity =>
        {
            entity.ToTable("BidSheetPreferences", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.TradeUnitKey).HasMaxLength(500).IsRequired();
            entity.Property(e => e.CropCode).HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.Month).IsRequired(false);
            entity.Property(e => e.CropYear).IsRequired(false);
            entity.Property(e => e.CropOrder).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(e => e.HiddenCrops).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(e => e.SelectedMonths).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(e => e.PrintLayout).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(e => e.ModifiedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.HasIndex(e => new { e.UserId, e.TradeUnitKey }).IsUnique().HasDatabaseName("UQ_BidSheetPreferences_User_TradeUnitKey");
            entity.HasIndex(e => e.UserId).HasDatabaseName("IX_BidSheetPreferences_UserId");
        });

        modelBuilder.Entity<HarvestWindow>(entity =>
        {
            entity.ToTable("HarvestWindows", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Commodity).HasMaxLength(50).IsRequired();
            entity.Property(e => e.DeliveryStartMonth).IsRequired();
            entity.Property(e => e.DeliveryStartDay).IsRequired();
            entity.Property(e => e.DeliveryEndMonth).IsRequired();
            entity.Property(e => e.DeliveryEndDay).IsRequired();
            entity.Property(e => e.IsActive).HasDefaultValue(true).IsRequired();
            entity.HasIndex(e => e.Commodity).HasDatabaseName("IX_HarvestWindows_Commodity");
        });

        modelBuilder.Entity<UserActivity>(entity =>
        {
            entity.ToTable("UserActivity", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.HttpMethod).HasMaxLength(10).IsRequired();
            entity.Property(e => e.Path).HasMaxLength(500).IsRequired();
            entity.Property(e => e.StatusCode).IsRequired();
            entity.Property(e => e.DurationMs).IsRequired();
            entity.Property(e => e.FeatureCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.SubFeatureCode).HasMaxLength(50);
            entity.Property(e => e.Timestamp).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
            entity.HasIndex(e => e.Timestamp).HasDatabaseName("IX_UserActivity_Timestamp");
            entity.HasIndex(e => new { e.UserId, e.Timestamp }).HasDatabaseName("IX_UserActivity_UserId_Timestamp");
            entity.HasIndex(e => new { e.FeatureCode, e.Timestamp }).HasDatabaseName("IX_UserActivity_FeatureCode_Timestamp");
        });

        modelBuilder.Entity<UserClickEvent>(entity =>
        {
            entity.ToTable("UserClickEvent", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.EventType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.FeatureCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.SubFeatureCode).HasMaxLength(50);
            entity.Property(e => e.TargetId).HasMaxLength(200);
            entity.Property(e => e.Timestamp).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
            entity.HasIndex(e => new { e.UserId, e.Timestamp }).HasDatabaseName("IX_UserClickEvent_UserId_Timestamp");
            entity.HasIndex(e => new { e.EventType, e.Timestamp }).HasDatabaseName("IX_UserClickEvent_EventType_Timestamp");
            entity.HasIndex(e => e.Timestamp).HasDatabaseName("IX_UserClickEvent_Timestamp");
        });

        modelBuilder.Entity<UserSession>(entity =>
        {
            entity.ToTable("UserSession", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.LoginTime).IsRequired();
            entity.Property(e => e.LastActivityTime).IsRequired();
            entity.Property(e => e.DurationMinutes)
                .HasComputedColumnSql("DATEDIFF(MINUTE, LoginTime, LastActivityTime)", stored: true);
            entity.HasIndex(e => new { e.UserId, e.LoginTime }).HasDatabaseName("IX_UserSession_UserId_LoginTime");
            entity.HasIndex(e => e.LoginTime).HasDatabaseName("IX_UserSession_LoginTime");
        });

        modelBuilder.Entity<UserActivityDaily>(entity =>
        {
            entity.ToTable("UserActivityDaily", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.ActivityDate).IsRequired();
            entity.Property(e => e.RequestCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.SessionCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.TotalSessionMinutes).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.CustomersViewed).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.ContractsViewed).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.NotesCreated).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.ListsBuilt).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.PlantingIntentionsAdded).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.ProducerDetailsViewed).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.CallClicks).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.EmailClicks).HasDefaultValue(0).IsRequired();
            entity.HasIndex(e => new { e.UserId, e.ActivityDate }).IsUnique()
                .HasDatabaseName("UQ_UserActivityDaily_UserId_Date");
            entity.HasIndex(e => e.ActivityDate).HasDatabaseName("IX_UserActivityDaily_Date");
        });

        modelBuilder.Entity<FeatureUsageDaily>(entity =>
        {
            entity.ToTable("FeatureUsageDaily", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd();
            entity.Property(e => e.ActivityDate).IsRequired();
            entity.Property(e => e.FeatureCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.SubFeatureCode).HasMaxLength(50).HasDefaultValue("__total__").IsRequired();
            entity.Property(e => e.SessionCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.UniqueUsers).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.RequestCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.ClickCount).HasDefaultValue(0).IsRequired();
            entity.HasIndex(e => new { e.ActivityDate, e.FeatureCode, e.SubFeatureCode }).IsUnique()
                .HasDatabaseName("UQ_FeatureUsageDaily");
            entity.HasIndex(e => new { e.FeatureCode, e.ActivityDate }).HasDatabaseName("IX_FeatureUsageDaily_FeatureCode");
        });

        modelBuilder.Entity<WeeklyLoginAggregate>(entity =>
        {
            entity.ToTable("WeeklyLoginAggregate", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd();
            entity.Property(e => e.WeekStartDate).IsRequired();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.LoginCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.SessionCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.TotalSessionMin).HasDefaultValue(0).IsRequired();
            entity.HasIndex(e => new { e.WeekStartDate, e.UserId }).IsUnique()
                .HasDatabaseName("UQ_WeeklyLoginAggregate");
            entity.HasIndex(e => e.WeekStartDate).HasDatabaseName("IX_WeeklyLoginAggregate_WeekStart");
        });

        modelBuilder.Entity<UserTradeUnitSnapshot>(entity =>
        {
            entity.ToTable("UserTradeUnitSnapshot", schema: "dbo");
            entity.HasKey(e => new { e.UserId, e.TradeUnitCode });
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(255).IsRequired();
            entity.Property(e => e.TradeUnitCode).HasMaxLength(100).IsRequired();
            entity.Property(e => e.GroupName).HasMaxLength(100);
            entity.Property(e => e.SnapshotDate).HasDefaultValueSql("CAST(SYSUTCDATETIME() AS DATE)").IsRequired();
            entity.HasIndex(e => e.TradeUnitCode).HasDatabaseName("IX_UserTradeUnitSnapshot_TradeUnitCode");
        });

        modelBuilder.Entity<QueryLibraryItem>(entity =>
        {
            entity.ToTable("QueryLibrary", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.Category).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.Property(e => e.QueryText).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Tags).HasMaxLength(500);
            entity.Property(e => e.SortOrder).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.IsActive).HasDefaultValue(true).IsRequired();
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        });

        modelBuilder.Entity<QuerySearchLog>(entity =>
        {
            entity.ToTable("QuerySearchLog", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.SearchText).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Timestamp).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        });
    }
}
