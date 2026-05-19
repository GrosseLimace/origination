using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Data;

/// <summary>
/// Entity Framework DbContext for the Grain Origination Portal.
/// Manages database connections and entity mappings for all domain models.
/// </summary>
public class OriginationDbContext : DbContext
{
    public OriginationDbContext(DbContextOptions<OriginationDbContext> options)
        : base(options)
    {
    }

    // DbSet properties for each entity
    // Contract and Ticket exist in ODS (base schema). CustomerTradeUnitView is the
    // read-only projection of originations.vw_CustomerTradeUnits and drives the
    // dbo.Customer / dbo.CustomerTradeUnit sync + per-request customer access checks.
    public DbSet<CustomerTradeUnitView> CustomerTradeUnits => Set<CustomerTradeUnitView>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketQuality> TicketQualities => Set<TicketQuality>();
    public DbSet<ContractPricingLine> ContractPricingLines => Set<ContractPricingLine>();
    public DbSet<Elevator> Elevators => Set<Elevator>();
    public DbSet<CommodityConversion> CommodityConversions => Set<CommodityConversion>();

    // Application tables - Notes and TradeUnits moved to ApplicationDbContext (Origination database)

    // These tables don't exist yet - will return empty data
    // public DbSet<Farm> Farms => Set<Farm>();
    // public DbSet<PlantingIntention> PlantingIntentions => Set<PlantingIntention>();
    // public DbSet<StoredGrain> StoredGrains => Set<StoredGrain>();
    // public DbSet<SavedList> SavedLists => Set<SavedList>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Configure CustomerTradeUnitView — maps to originations.vw_CustomerTradeUnits (no key — view only).
        // The Customer entity is owned by ApplicationDbContext (dbo.Customer) — no mapping here.
        modelBuilder.Entity<CustomerTradeUnitView>(entity =>
        {
            entity.ToView("vw_CustomerTradeUnits", schema: "originations");
            entity.HasNoKey();
            // The ODS view still exposes the column as SourceCustomerId. The app-DB
            // CustomerSnapshot was renamed to ScoularId in migration 20260430164629,
            // but the ODS view is owned by another team and not renamed. Map here
            // so EF queries the right column name in ODS.
            entity.Property(e => e.ScoularId).HasColumnName("SourceCustomerId");
        });

        // Configure Farm entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<Farm>(entity =>
        // {
        //     entity.ToTable("Farms");
        //     entity.HasKey(e => e.Id);
        //     entity.Property(e => e.Id).HasMaxLength(50).IsRequired();
        //     entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
        //     entity.Property(e => e.Location).HasMaxLength(200);
        //     entity.Property(e => e.Acres).IsRequired();
        //     entity.Property(e => e.BinStorageCapacity);
        //
        //     entity.HasIndex(e => e.Name);
        // });

        // Configure Contract entity - Maps to ODS vw_CurrentContracts view in base schema
        modelBuilder.Entity<Contract>(entity =>
        {
            entity.ToTable("vw_CurrentContracts", schema: "base"); // View with filtered contracts
            entity.HasKey(e => e.Id);

            // Map to ODS column names - essential fields for displaying contracts
            entity.Property(e => e.Id).HasColumnName("ContractId").IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId"); // FK to Customer
            entity.Property(e => e.CtrmCustomerId).HasColumnName("CtrmCustomerId").HasMaxLength(400).IsRequired(false).HasConversion(v => v, v => v != null ? v.Trim() : v); // Used for saved lists
            // Trim on read — ODS source columns are CHAR-padded, which causes mismatches when
            // these IDs are compared against trimmed values from other places (e.g. ticket
            // ContractNumber matched to contract SourceContractId).
            entity.Property(e => e.SourceContractId).HasColumnName("SourceContractId").HasMaxLength(64).IsRequired(false).HasConversion(v => v, v => v != null ? v.Trim() : v);
            entity.Property(e => e.ContractNumber).HasColumnName("ContractNumber").HasMaxLength(100).IsRequired(false).HasConversion(v => v, v => v != null ? v.Trim() : v);
            entity.Property(e => e.ContractPrefixType).HasColumnName("ContractPrefixType").HasMaxLength(10).IsRequired(false);

            // Customer and commodity info
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(500).IsRequired(false);
            entity.Property(e => e.CommodityCode).HasColumnName("CommodityCode").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.CommodityDescription).HasColumnName("CommodityDescription").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.CommodityGroup).HasColumnName("CommodityGroup").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired(false);

            // Quantity and pricing - mapped to actual ODS column names
            entity.Property(e => e.Quantity).HasColumnName("Quantity").HasColumnType("decimal(18,6)").IsRequired(false);
            entity.Property(e => e.PricedQuantity).HasColumnName("PricedQuantity").HasColumnType("decimal(18,6)").IsRequired(false);
            entity.Property(e => e.Unit).HasColumnName("QuantityUom").HasMaxLength(16).IsRequired(false);
            entity.Property(e => e.TotalValue).HasColumnName("TotalValue").HasColumnType("decimal(18,2)").IsRequired(false);

            // Price will be calculated as TotalValue / Quantity
            entity.Ignore(e => e.Price);

            // Dates - mapped to actual ODS column names
            entity.Property(e => e.ContractDate).HasColumnName("ContractDate").HasColumnType("date").IsRequired(false);
            entity.Property(e => e.DeliveryStart).HasColumnName("StartShipDate").HasColumnType("date").IsRequired(false);
            entity.Property(e => e.DeliveryEnd).HasColumnName("FinalShipDate").HasColumnType("date").IsRequired(false);
            entity.Property(e => e.ClosedDate).HasColumnName("ClosedDate").HasColumnType("date").IsRequired(false);

            // Crop year and open balance
            entity.Property(e => e.CropYear).HasColumnName("CropYear").IsRequired(false);
            entity.Property(e => e.OpenBalanceQuantity).HasColumnName("OpenBalanceQuantity").HasColumnType("decimal(18,6)").IsRequired(false);

            // Pricing
            entity.Property(e => e.PriceTypeCode).HasColumnName("PriceTypeCode").HasMaxLength(10).IsRequired(false);
            entity.Property(e => e.SpecialType).HasColumnName("SpecialType").HasMaxLength(50).IsRequired(false);

            // Customer confirmation status
            entity.Property(e => e.CustomerConfirmStatus).HasColumnName("CustomerConfirmStatus").HasMaxLength(100).IsRequired(false);

            // Market zone and basis price location
            entity.Property(e => e.MarketZone).HasColumnName("MarketZone").HasMaxLength(200).IsRequired(false);
            entity.Property(e => e.BasisLocation).HasColumnName("BasisLocation").HasMaxLength(200).IsRequired(false);

            // Hedge market month — NOT in vw_CurrentContracts. Lives on base.Contract
            // only and is enriched via a side-query in SqlDataService after the main
            // fetch (EnrichWithHedgeMarketMonthAsync). Ignored here so EF doesn't try
            // to project these columns from the view, which would throw SQL 207.
            entity.Ignore(e => e.HedgeMarketMonth);
            entity.Ignore(e => e.HedgeMarketMonthDescription);

            // Metadata
            entity.Property(e => e.IsActive).HasColumnName("IsActive").IsRequired();
            entity.Ignore(e => e.IsDeleted); // Not in vw_CurrentContracts; used only by historical pacing query on base.Contract
            entity.Property(e => e.EffectiveStartDate).HasColumnName("EffectiveStartDate").IsRequired(false);
            entity.Property(e => e.EffectiveEndDate).HasColumnName("EffectiveEndDate").IsRequired(false);

            // Fields not in ODS view - ignore these
            entity.Ignore(e => e.FarmId);
            entity.Ignore(e => e.Weight);
            entity.Ignore(e => e.Status);
            entity.Ignore(e => e.Signed);

            // No HasOne<Customer> FK declaration here — Customer is owned by
            // ApplicationDbContext (dbo.Customer), not this context. Adding an
            // implicit Customer mapping here would break the OriginationDbContext
            // model. The CustomerId column is just an indexed bigint at the ODS view level.

            // Index on ContractNumber and CustomerId for common queries
            entity.HasIndex(e => e.ContractNumber);
            entity.HasIndex(e => e.CustomerId);
        });

        // Configure Ticket entity - Maps to ODS vw_CurrentTickets view in base schema
        modelBuilder.Entity<Ticket>(entity =>
        {
            entity.ToTable("vw_CurrentTickets", schema: "base"); // View with filtered tickets (excludes cancellations)
            entity.HasKey(e => e.Id);

            // Map to ODS column names - only the fields that exist
            entity.Property(e => e.Id).HasColumnName("TicketId").IsRequired();
            entity.Property(e => e.ContractId).HasColumnName("ContractId");
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId");
            entity.Property(e => e.CustomerCode).HasColumnName("CustomerCode").HasMaxLength(400).HasConversion(v => v, v => v != null ? v.Trim() : v);

            // Ticket identifiers
            entity.Property(e => e.ProductCode).HasColumnName("ProductCode").HasMaxLength(100).HasConversion(v => v, v => v != null ? v.Trim() : v);
            entity.Property(e => e.TicketPrefix).HasColumnName("TicketPrefix").HasMaxLength(100);
            entity.Property(e => e.TicketNumber).HasColumnName("TicketNumber").HasMaxLength(100);
            entity.Property(e => e.TicketSuffix).HasColumnName("TicketSuffix").HasMaxLength(100);
            entity.Property(e => e.ShipmentTicketNumber).HasColumnName("ShipmentTicketNumber").HasMaxLength(100);
            // Trim on read — ODS pads ContractNumber with whitespace; HashSet/string compares
            // against Contract.SourceContractId fail without this.
            entity.Property(e => e.CtrmContractNumber).HasColumnName("ContractNumber").HasMaxLength(100).HasConversion(v => v, v => v != null ? v.Trim() : v);
            entity.Property(e => e.OrganizationCode).HasColumnName("OrganizationCode").HasMaxLength(100);
            entity.Property(e => e.ElevatorCode).HasColumnName("ElevatorCode").HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.UnloadOrganizationCode).HasColumnName("UnloadOrganizationCode").HasMaxLength(20).IsRequired(false);
            entity.Ignore(e => e.ElevatorCity);   // Populated in-memory from elevator lookup
            entity.Ignore(e => e.ElevatorState);  // Populated in-memory from elevator lookup

            // Dates - using TicketBlDate and FinalSettledDate from view
            entity.Property(e => e.Date).HasColumnName("TicketBlDate");
            entity.Property(e => e.FinalSettledDate).HasColumnName("FinalSettledDate");

            // Quantities - map to actual ODS columns
            entity.Property(e => e.UnloadQuantity).HasColumnName("UnloadQuantity").HasColumnType("decimal(18,6)");
            entity.Property(e => e.LoadoutQuantity).HasColumnName("LoadoutQuantity").HasColumnType("decimal(18,6)");
            // AppliedNetQuantity is bigint in ODS - let EF Core handle the type automatically
            entity.Property(e => e.AppliedDockQuantity).HasColumnName("AppliedNetQuantity");

            // Classification
            entity.Property(e => e.TicketType).HasColumnName("TicketType").HasMaxLength(10);
            entity.Ignore(e => e.IsApplied); // Computed from CtrmContractNumber prefix — not a DB column

            // Status
            entity.Property(e => e.TicketStatusDescription).HasColumnName("TicketStatusDescription").HasMaxLength(100);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true);

            // Quality measures - check if available in base.Ticket table
            entity.Property(e => e.GradeCode).HasColumnName("GradeCode").HasMaxLength(100);

            // Fields not in base.Ticket table - ignore these
            entity.Ignore(e => e.SourceTicketHeaderId);
            entity.Ignore(e => e.SourceTicketDetailId);
            entity.Ignore(e => e.AppliedQuantity);
            entity.Ignore(e => e.Moisture);
            entity.Ignore(e => e.TestWeight);
            entity.Ignore(e => e.ProteinPercent);
            entity.Ignore(e => e.FarmId);
            entity.Ignore(e => e.GrossWeight);
            entity.Ignore(e => e.TareWeight);
            entity.Ignore(e => e.NetWeight);

            // No HasOne<Customer> FK declaration — Customer is owned by ApplicationDbContext.
            // The CustomerId column is just an indexed bigint at the ODS view level here.

            // Foreign key relationship to Contract (within this ODS context)
            entity.HasOne<Contract>()
                .WithMany()
                .HasForeignKey(e => e.ContractId)
                .OnDelete(DeleteBehavior.NoAction); // Use NoAction to avoid cascade issues

            // Indexes for common queries
            entity.HasIndex(e => e.CustomerId);
            entity.HasIndex(e => e.ContractId);
            entity.HasIndex(e => e.TicketNumber);
            entity.HasIndex(e => e.Date);
        });

        // Configure TicketQuality entity - Maps to ODS vw_TicketQuality view
        modelBuilder.Entity<TicketQuality>(entity =>
        {
            entity.ToView("vw_TicketQuality", schema: "base");
            entity.HasKey(e => e.TicketId);

            entity.Property(e => e.TicketId).HasColumnName("TicketId").IsRequired();
            entity.Property(e => e.GradeFactorMoisturePercent).HasColumnName("GradeFactorMoisturePercent").HasColumnType("decimal(18,6)");
            entity.Property(e => e.GradeFactorProteinPercent).HasColumnName("GradeFactorProteinPercent").HasColumnType("decimal(18,6)");
            entity.Property(e => e.GradeFactorTestWeightPercent).HasColumnName("GradeFactorTestWeightPercent").HasColumnType("decimal(18,6)");
            entity.Property(e => e.GradeCode).HasColumnName("GradeCode").HasMaxLength(100);
        });

        // Configure ContractPricingLine — maps to base.vw_ContractPricing (read-only view)
        modelBuilder.Entity<ContractPricingLine>(entity =>
        {
            entity.HasNoKey();
            entity.ToView("vw_ContractPricing", schema: "base");

            // ContractId maps to SourceContractId — the string key used to link to Contract.SourceContractId.
            // Trim on read for parity with the Contract entity (CHAR-padded ODS columns).
            entity.Property(e => e.ContractId).HasColumnName("SourceContractId").HasMaxLength(64).HasConversion(v => v, v => v != null ? v.Trim() : v);
            entity.Property(e => e.ContractNumber).HasColumnName("ContractNumber").HasMaxLength(50).HasConversion(v => v, v => v != null ? v.Trim() : v);
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(500);
            entity.Property(e => e.PriceSequence).HasColumnName("PriceSequence");
            entity.Property(e => e.PriceQuantity).HasColumnName("PriceQuantity").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PriceUom).HasColumnName("PriceUom").HasMaxLength(16);
            entity.Property(e => e.FlatPrice).HasColumnName("FlatPrice").HasColumnType("decimal(18,6)");
            entity.Property(e => e.BasisPrice).HasColumnName("BasisPrice").HasColumnType("decimal(18,6)");
            entity.Property(e => e.HedgePrice).HasColumnName("HedgePrice").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PriceDate).HasColumnName("PriceDate");
            entity.Property(e => e.PriceCurrency).HasColumnName("PriceCurrency").HasMaxLength(10);
            entity.Property(e => e.TraderInitials).HasColumnName("TraderInitials").HasMaxLength(20);
            entity.Property(e => e.Trader).HasColumnName("Trader").HasMaxLength(200);
            entity.Property(e => e.PriceOpenQuantity).HasColumnName("PriceOpenQuantity").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PriceAppliedQuantity).HasColumnName("PriceAppliedQuantity").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PriceSettledQuantity).HasColumnName("PriceSettledQuantity").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PriceOpenWeight).HasColumnName("PriceOpenWeight").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PriceAppliedWeight).HasColumnName("PriceAppliedWeight").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PriceSettledWeight).HasColumnName("PriceSettledWeight").HasColumnType("decimal(18,6)");
            entity.Property(e => e.CustomerConfirmStatus).HasColumnName("CustomerConfirmStatus").HasMaxLength(100);
            entity.Property(e => e.BrokerConfirmStatus).HasColumnName("BrokerConfirmStatus").HasMaxLength(100);
            entity.Property(e => e.ConfirmationStatus).HasColumnName("ConfirmationStatus").HasMaxLength(100);
            entity.Property(e => e.CreatedDate).HasColumnName("CreatedDate");
            entity.Property(e => e.ModifiedDate).HasColumnName("ModifiedDate");

            // Computed properties — ignored by EF (derived from stored columns above)
            entity.Ignore(e => e.PricedQty);
            entity.Ignore(e => e.CashPrice);
        });

        // Note and TradeUnit entity configuration moved to ApplicationDbContext

        // Configure PlantingIntention entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<PlantingIntention>(entity => { ... });

        // Configure StoredGrain — keyless result type for SqlQueryRaw (no table/view mapping)
        modelBuilder.Entity<StoredGrain>(entity =>
        {
            entity.HasNoKey();
            entity.Ignore(e => e.Bushels);
            entity.Ignore(e => e.DateReceived);
        });

        // Configure SavedList entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<SavedList>(entity => { ... });

        // Configure Elevator — maps to ctrm.vw_GNP026 (read-only view, no PK)
        modelBuilder.Entity<Elevator>(entity =>
        {
            entity.ToView("vw_GNP026", schema: "ctrm");
            entity.HasNoKey();
            entity.Property(e => e.ElevatorCode).HasColumnName("Elevator_Code").HasMaxLength(6);
            entity.Property(e => e.ElevatorShortName).HasColumnName("Elevator_Short_Name").HasMaxLength(4);
            entity.Property(e => e.ElevatorName).HasColumnName("Elevator_Name").HasMaxLength(30);
            entity.Property(e => e.Address1).HasColumnName("Elevator_Address_1").HasMaxLength(30);
            entity.Property(e => e.Address2).HasColumnName("Elevator_Address_2").HasMaxLength(30);
            entity.Property(e => e.City).HasColumnName("Elevator_City").HasMaxLength(15);
            entity.Property(e => e.State).HasColumnName("Elevator_State").HasMaxLength(2);
            entity.Property(e => e.ZipCode).HasColumnName("Division_Zip_Code").HasColumnType("decimal(18,0)");
            entity.Property(e => e.OurFacility).HasColumnName("Our_Facility").HasMaxLength(1);
            entity.Property(e => e.BushelCapacity).HasColumnName("Bushel_Capacity_In_Bushels").HasColumnType("decimal(18,0)");
            entity.Property(e => e.ElevatorCompanyCode).HasColumnName("Elevator_Company_Code").HasMaxLength(2);
            entity.Property(e => e.ElevatorDivisionCode).HasColumnName("Elevator_Division_Code").HasMaxLength(2);
            entity.Property(e => e.ElevatorLocationCode).HasColumnName("Elevator_Location_Code").HasMaxLength(4);
            entity.Ignore(e => e.Latitude);
            entity.Ignore(e => e.Longitude);
        });

        // Configure Location — maps to ctrm.vw_GNP003 (read-only view, no PK).
        // Used as the fallback for ticket location lookups when the ticket has no
        // ElevatorCode — the ticket's OrganizationCode is matched against Location_Code.
        modelBuilder.Entity<Location>(entity =>
        {
            entity.ToView("vw_GNP003", schema: "ctrm");
            entity.HasNoKey();
            entity.Property(e => e.LocationCode).HasColumnName("Location_Code").HasMaxLength(4);
            entity.Property(e => e.City).HasColumnName("Location_City").HasMaxLength(30);
            entity.Property(e => e.State).HasColumnName("Location_State").HasMaxLength(2);
        });

        // Configure CommodityConversion — maps to ctrm.vw_GNP024 (read-only view, no PK)
        modelBuilder.Entity<CommodityConversion>(entity =>
        {
            entity.ToView("vw_GNP024", schema: "ctrm");
            entity.HasNoKey();
            entity.Property(e => e.CommodityCode).HasColumnName("Commodity_Code").HasMaxLength(10);
            entity.Property(e => e.Description).HasColumnName("Commodity_Full_Description").HasMaxLength(100);
            entity.Property(e => e.LbsPerUnit).HasColumnName("Pounds_To_Commodity_Unit").HasColumnType("decimal(18,6)");
            entity.Property(e => e.UnitOfMeasure).HasColumnName("Commodity_Std_Unit_Measure").HasMaxLength(10);
        });
    }
}
