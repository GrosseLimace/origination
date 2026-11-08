using Microsoft.EntityFrameworkCore;

using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Sync;
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Lists.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

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
    public DbSet<ProducerReminder> ProducerReminders => Set<ProducerReminder>();
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
    public DbSet<ProducerContact> ProducerContacts => Set<ProducerContact>();
    public DbSet<ProducerBinSite> ProducerBinSites => Set<ProducerBinSite>();
    public DbSet<UserPreference> UserPreferences => Set<UserPreference>();
    public DbSet<BidSheetLocation> BidSheetLocations => Set<BidSheetLocation>();
    public DbSet<BidSheetLocationBid> BidSheetLocationBids => Set<BidSheetLocationBid>();
    public DbSet<BidSheetPreference> BidSheetPreferences => Set<BidSheetPreference>();
    public DbSet<BidSheet> BidSheets => Set<BidSheet>();
    public DbSet<BidSheetShare> BidSheetShares => Set<BidSheetShare>();
    public DbSet<BidSheetLocationLink> BidSheetLocationLinks => Set<BidSheetLocationLink>();
    public DbSet<ElevatorCache> ElevatorCaches => Set<ElevatorCache>();
    public DbSet<HarvestWindow> HarvestWindows => Set<HarvestWindow>();
    public DbSet<UserActivity> UserActivities => Set<UserActivity>();
    public DbSet<UserClickEvent> UserClickEvents => Set<UserClickEvent>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<UserActivityDaily> UserActivityDailies => Set<UserActivityDaily>();
    public DbSet<FeatureUsageDaily> FeatureUsageDailies => Set<FeatureUsageDaily>();
    public DbSet<UserFeatureUsageDaily> UserFeatureUsageDailies => Set<UserFeatureUsageDaily>();
    public DbSet<WeeklyLoginAggregate> WeeklyLoginAggregates => Set<WeeklyLoginAggregate>();
    public DbSet<UserTradeUnitSnapshot> UserTradeUnitSnapshots => Set<UserTradeUnitSnapshot>();
    public DbSet<QueryLibraryItem> QueryLibrary => Set<QueryLibraryItem>();
    public DbSet<QuerySearchLog> QuerySearchLogs => Set<QuerySearchLog>();
    public DbSet<DailyRecapGroup> DailyRecapGroups => Set<DailyRecapGroup>();
    public DbSet<DailyRecapGroupMember> DailyRecapGroupMembers => Set<DailyRecapGroupMember>();
    public DbSet<DailyRecapGroupCcEmail> DailyRecapGroupCcEmails => Set<DailyRecapGroupCcEmail>();
    public DbSet<TeamsChannel> TeamsChannels => Set<TeamsChannel>();
    public DbSet<UsageDashboardExcludedUser> UsageDashboardExcludedUsers => Set<UsageDashboardExcludedUser>();
    public DbSet<MbpLocationSynonym> MbpLocationSynonyms => Set<MbpLocationSynonym>();

    // BarChart bid feed — vendor-loaded landing tables. Written by the ingest API
    // (api/barchart-ingest); see docs/application-context/Barchart Bid Feed - Database Plan.md.
    public DbSet<BarchartInstrument> BarchartInstruments => Set<BarchartInstrument>();
    public DbSet<BarchartCurrentQuote> BarchartCurrentQuotes => Set<BarchartCurrentQuote>();
    public DbSet<BarchartQuoteSnapshot> BarchartQuoteSnapshots => Set<BarchartQuoteSnapshot>();
    public DbSet<BarchartCommodityMap> BarchartCommodityMaps => Set<BarchartCommodityMap>();
    public DbSet<BarchartApiCallAudit> BarchartApiCallAudits => Set<BarchartApiCallAudit>();
    /// <summary>Read model over dbo.vw_BarchartLocation — one row per elevator listing, for the picker.</summary>
    public DbSet<BarchartLocationSummary> BarchartLocationSummaries => Set<BarchartLocationSummary>();

    // Field plan & sustainability programs; see docs/application-context/Field Plan - Database Plan.md.
    public DbSet<ProducerField> ProducerFields => Set<ProducerField>();
    public DbSet<ProducerFieldSeason> ProducerFieldSeasons => Set<ProducerFieldSeason>();
    public DbSet<FieldProgramRecord> FieldProgramRecords => Set<FieldProgramRecord>();
    public DbSet<FieldPlanDocument> FieldPlanDocuments => Set<FieldPlanDocument>();

    // Access: roles, the permission catalog and the grants between them; see Platform/Access and plan §4.3.
    // The first tables in the module layout (plan §4.1): entities and configurations live with the module.
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<RoleSegment> RoleSegments => Set<RoleSegment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Every IEntityTypeConfiguration in this assembly configures this context; each module keeps its own in
        // its Configurations folder. The read-only contexts (OriginationDbContext, DpOdsDbContext and
        // TradeUnitPreferencesDbContext) configure their entities inline in their own OnModelCreating, and
        // ApplicationDbContextModelTests fails if one of their entities turns up in this model.
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ApplicationDbContext).Assembly);

        // Ids for producers the customer sync finds only in CTRM (they have no ODS surrogate id), drawn from the
        // reserved band [5e15, 6e15). The AddCustomerIdSequence migration creates the real sequence with a start
        // computed from the live MAX(CustomerId); StartsAt here is only the model default. See D5 of
        // agents-docs/plans/customers-from-graphql-design_2026-10-06.md and CustomerIdMinting.
        modelBuilder.HasSequence<long>(CustomerIdMinting.SequenceName, CustomerIdMinting.SequenceSchema).StartsAt(CustomerIdMinting.ReservedBase).IncrementsBy(1);

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
            entity.Property(e => e.TradeGroupScope).HasColumnName("TradeGroupScope").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.TradeUnitScope).HasColumnName("TradeUnitScope").HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.PlantingCategory).HasColumnName("PlantingCategory").HasMaxLength(100).IsRequired(false);

            entity.HasIndex(e => e.Code).IsUnique().HasDatabaseName("IX_Commodities_Code");
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

        // ── BarChart bid feed ────────────────────────────────────────────────────────
        // Vendor-loaded tables. Prices are DECIMAL(19,4) and all timestamps are DATETIME2(3)
        // stored UTC (the vendor sends offsets; the load SQL converts) per style-guides/sql.md.
        // These tables intentionally carry purpose-built timestamps (FirstSeen/LastSeen/Updated/
        // Created) rather than the standard CreatedBy/ModifiedBy audit set — there is no meaningful
        // human actor for machine-loaded vendor rows. BarchartCommodityMap is the exception: it is
        // human-maintained and carries the full audit columns.

        // Read model for the picker. ToView keeps it out of migrations; the view itself is created by
        // the AddBarchartFeed migration. Keyless because it is a projection, never written to.
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

        modelBuilder.Entity<UserFeatureUsageDaily>(entity =>
        {
            entity.ToTable("UserFeatureUsageDaily", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd();
            entity.Property(e => e.ActivityDate).IsRequired();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.FeatureCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.SubFeatureCode).HasMaxLength(50).HasDefaultValue("__total__").IsRequired();
            entity.Property(e => e.RequestCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.InteractionCount).HasDefaultValue(0).IsRequired();
            entity.Property(e => e.ScreenMinutes).HasDefaultValue(0d).IsRequired();
            entity.HasIndex(e => new { e.ActivityDate, e.UserId, e.FeatureCode, e.SubFeatureCode }).IsUnique()
                .HasDatabaseName("UQ_UserFeatureUsageDaily");
            entity.HasIndex(e => new { e.FeatureCode, e.ActivityDate }).HasDatabaseName("IX_UserFeatureUsageDaily_FeatureCode");
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

        modelBuilder.Entity<QuerySearchLog>(entity =>
        {
            entity.ToTable("QuerySearchLog", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.SearchText).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Timestamp).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        });

        modelBuilder.Entity<UsageDashboardExcludedUser>(entity =>
        {
            entity.ToTable("UsageDashboardExcludedUsers", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
            entity.Property(e => e.Reason).HasMaxLength(500).IsRequired(false);
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired().HasDefaultValue("system");
            // Unique so the same account can't be excluded twice; SQL Server's default CI collation
            // makes it case-insensitive, matching how the dashboard keys users.
            entity.HasIndex(e => e.UserId).IsUnique().HasDatabaseName("IX_UsageDashboardExcludedUsers_UserId");
        });

        modelBuilder.Entity<MbpLocationSynonym>(entity =>
        {
            entity.ToTable("MbpLocationSynonym", schema: "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
            entity.Property(e => e.LocationId).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Location).HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.Elevator).HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.DisplayName).HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.AddressLine1).HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.AddressLine2).HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.City).HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.State).HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.Country).HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.ZipCode).HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.Phone).HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.Fax).HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.Email).HasMaxLength(256).IsRequired(false);
            entity.Property(e => e.Website).HasMaxLength(256).IsRequired(false);
            entity.Property(e => e.PushNotificationsHidden).HasMaxLength(1).IsFixedLength().IsRequired(false);
            entity.Property(e => e.CashBidsHidden).HasMaxLength(1).IsFixedLength().IsRequired(false);
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.DeletedByUser).HasMaxLength(128).IsRequired(false);
            entity.Property(e => e.DeletedAtSvStamp).IsRequired(false);
            entity.Property(e => e.CreatedByUser).HasMaxLength(128).IsRequired(false);
            entity.Property(e => e.CreatedStamp).IsRequired(false);
            entity.Property(e => e.ChangedByUser).HasMaxLength(128).IsRequired(false);
            entity.Property(e => e.ChangeStamp).IsRequired(false);
            entity.HasIndex(e => e.LocationId).IsUnique().HasDatabaseName("IX_MbpLocationSynonym_LocationId");
        });
    }
}
