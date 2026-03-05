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
    // Customer, Contract, and Ticket exist in ODS (base schema)
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketQuality> TicketQualities => Set<TicketQuality>();
    public DbSet<ContractPricingLine> ContractPricingLines => Set<ContractPricingLine>();

    // Application tables - Notes and TradeUnits moved to ApplicationDbContext (Origination database)

    // These tables don't exist yet - will return empty data
    // public DbSet<Farm> Farms => Set<Farm>();
    // public DbSet<PlantingIntention> PlantingIntentions => Set<PlantingIntention>();
    // public DbSet<StoredGrain> StoredGrains => Set<StoredGrain>();
    // public DbSet<SavedList> SavedLists => Set<SavedList>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Configure Customer entity - Maps to originations.vw_CurrentCustomers (pre-filtered: PR, IsActive, no DUP/DO NOT USE/symbol names)
        modelBuilder.Entity<Customer>(entity =>
        {
            entity.ToTable("vw_CurrentCustomers", schema: "originations");
            entity.HasKey(e => e.Id);

            // Map to vw_CurrentCustomers column names (PascalCase in base schema views)
            entity.Property(e => e.Id).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.Name).HasColumnName("CustomerName").HasMaxLength(500);

            // Contact information from view - map to merchandising contact columns (nullable)
            entity.Property(e => e.Phone).HasColumnName("MerchandisingPhone").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Email).HasColumnName("MerchandisingEmail").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedPrimaryPhone).HasColumnName("ExtendedPrimaryPhone").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.SupplementalEmail).HasColumnName("SupplementalEmail").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.Location).HasColumnName("MerchandisingCity").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.StateProvince).HasColumnName("MerchandisingStateProvince").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.AddressLine1).HasColumnName("MerchandisingAddressLine1").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.PostalCode).HasColumnName("MerchandisingPostalCode").HasMaxLength(20).IsRequired(false);

            // Extended address fields — more accurate location data for geocoding
            entity.Property(e => e.ExtendedAddressLine1).HasColumnName("ExtendedAddressLine1").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedAddressLine2).HasColumnName("ExtendedAddressLine2").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedAddressLine3).HasColumnName("ExtendedAddressLine3").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedAddressLine4).HasColumnName("ExtendedAddressLine4").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedCity).HasColumnName("ExtendedCity").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.ExtendedPostalCode).HasColumnName("ExtendedPostalCode").HasMaxLength(20).IsRequired(false);
            entity.Property(e => e.ExtendedStateProvince).HasColumnName("ExtendedStateProvince").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.ExtendedCountry).HasColumnName("ExtendedCountry").HasMaxLength(255).IsRequired(false);

            // Map available ODS metadata fields
            entity.Property(e => e.SourceCustomerId).HasColumnName("SourceCustomerId").HasMaxLength(400);
            entity.Property(e => e.IndustryCode1).HasColumnName("IndustryCode1").HasMaxLength(50).IsRequired(false);
            entity.Property(e => e.IsActive).HasColumnName("IsActive").IsRequired();
            entity.Property(e => e.EffectiveStartDate).HasColumnName("EffectiveStartDate");
            entity.Property(e => e.EffectiveEndDate).HasColumnName("EffectiveEndDate");

            // Not mapped to ODS (application-specific fields)
            entity.Ignore(e => e.CustomerCode);
            entity.Ignore(e => e.Farm);
            entity.Ignore(e => e.TotalAcres);
            entity.Ignore(e => e.ESignEnabled);
            entity.Ignore(e => e.ScoularViewRecipients);
            entity.Ignore(e => e.Coordinates);
            entity.Ignore(e => e.FarmIds);
            entity.Ignore(e => e.LinkedProducerIds);

            // Indexes for common queries
            entity.HasIndex(e => e.Name);
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
            entity.Property(e => e.CtrmCustomerId).HasColumnName("CtrmCustomerId").HasMaxLength(400).IsRequired(false); // Used for saved lists
            entity.Property(e => e.SourceContractId).HasColumnName("SourceContractId").HasMaxLength(64).IsRequired(false);
            entity.Property(e => e.ContractNumber).HasColumnName("ContractNumber").HasMaxLength(100).IsRequired(false);

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

            // Customer confirmation status
            entity.Property(e => e.CustomerConfirmStatus).HasColumnName("CustomerConfirmStatus").HasMaxLength(100).IsRequired(false);

            // Metadata
            entity.Property(e => e.IsActive).HasColumnName("IsActive").IsRequired();
            entity.Property(e => e.EffectiveStartDate).HasColumnName("EffectiveStartDate").IsRequired(false);
            entity.Property(e => e.EffectiveEndDate).HasColumnName("EffectiveEndDate").IsRequired(false);

            // Fields not in ODS view - ignore these
            entity.Ignore(e => e.FarmId);
            entity.Ignore(e => e.Weight);
            entity.Ignore(e => e.Status);
            entity.Ignore(e => e.Signed);

            // Foreign key relationship to Customer
            entity.HasOne<Customer>()
                .WithMany()
                .HasForeignKey(e => e.CustomerId)
                .OnDelete(DeleteBehavior.NoAction); // Use NoAction to avoid cascade issues

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
            entity.Property(e => e.CustomerCode).HasColumnName("CustomerCode").HasMaxLength(400);

            // Ticket identifiers
            entity.Property(e => e.ProductCode).HasColumnName("ProductCode").HasMaxLength(100);
            entity.Property(e => e.TicketPrefix).HasColumnName("TicketPrefix").HasMaxLength(100);
            entity.Property(e => e.TicketNumber).HasColumnName("TicketNumber").HasMaxLength(100);
            entity.Property(e => e.TicketSuffix).HasColumnName("TicketSuffix").HasMaxLength(100);
            entity.Property(e => e.ShipmentTicketNumber).HasColumnName("ShipmentTicketNumber").HasMaxLength(100);
            entity.Property(e => e.CtrmContractNumber).HasColumnName("ContractNumber").HasMaxLength(100);
            entity.Property(e => e.OrganizationCode).HasColumnName("OrganizationCode").HasMaxLength(100);

            // Dates - using TicketBlDate and FinalSettledDate from view
            entity.Property(e => e.Date).HasColumnName("TicketBlDate");
            entity.Property(e => e.FinalSettledDate).HasColumnName("FinalSettledDate");

            // Quantities - map to actual ODS columns
            entity.Property(e => e.UnloadQuantity).HasColumnName("UnloadQuantity").HasColumnType("decimal(18,6)");
            entity.Property(e => e.LoadoutQuantity).HasColumnName("LoadoutQuantity").HasColumnType("decimal(18,6)");
            // AppliedNetQuantity is bigint in ODS - let EF Core handle the type automatically
            entity.Property(e => e.AppliedDockQuantity).HasColumnName("AppliedNetQuantity");

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

            // Foreign key relationships
            entity.HasOne<Customer>()
                .WithMany()
                .HasForeignKey(e => e.CustomerId)
                .OnDelete(DeleteBehavior.NoAction); // Use NoAction to avoid cascade issues

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

        // Configure ContractPricingLine — maps to originations.vw_ContractPricing (read-only view)
        modelBuilder.Entity<ContractPricingLine>(entity =>
        {
            entity.HasNoKey();
            entity.ToView("vw_ContractPricing", schema: "originations");

            entity.Property(e => e.PriceSequence).HasColumnName("price_sequence");
            entity.Property(e => e.ContractId).HasColumnName("contract_id").HasMaxLength(64);
            entity.Property(e => e.DisplayId).HasColumnName("display_id").HasMaxLength(64);
            entity.Property(e => e.QuantityUom).HasColumnName("quantity_uom").HasMaxLength(16);
            entity.Property(e => e.CommodityCode).HasColumnName("commodity_code").HasMaxLength(100);
            entity.Property(e => e.PriceType).HasColumnName("price_type").HasMaxLength(16);
            entity.Property(e => e.Adjustment).HasColumnName("adjustment").HasColumnType("decimal(18,6)");
            entity.Property(e => e.BasisPrice).HasColumnName("basis_price").HasColumnType("decimal(18,6)");
            entity.Property(e => e.CashPrice).HasColumnName("cash_price").HasColumnType("decimal(18,6)");
            entity.Property(e => e.FuturesPrice).HasColumnName("futures_price").HasColumnType("decimal(18,6)");
            entity.Property(e => e.FuturesMonth).HasColumnName("futures_month").HasMaxLength(10);
            entity.Property(e => e.Currency).HasColumnName("currency").HasMaxLength(10);
            entity.Property(e => e.AppliedQty).HasColumnName("applied_qty").HasColumnType("decimal(18,6)");
            entity.Property(e => e.PricedQty).HasColumnName("priced_qty").HasColumnType("decimal(18,6)");
            entity.Property(e => e.ContractQty).HasColumnName("contract_qty").HasColumnType("decimal(18,6)");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.PricedAt).HasColumnName("priced_at");
            entity.Property(e => e.DeliveryPeriodStart).HasColumnName("delivery_period_start");
            entity.Property(e => e.DeliveryPeriodEnd).HasColumnName("delivery_period_end");
            entity.Property(e => e.SignatureStatus).HasColumnName("signature_status").HasMaxLength(16);
            entity.Property(e => e.DeliveryStatus).HasColumnName("delivery_status").HasMaxLength(32);
            entity.Property(e => e.PricingStatus).HasColumnName("pricing_status").HasMaxLength(32);
            entity.Property(e => e.LocationId).HasColumnName("location_id").HasMaxLength(50);
            entity.Property(e => e.SequenceNumber).HasColumnName("sequence_number");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id").HasMaxLength(50);
            entity.Property(e => e.CompanyCode).HasColumnName("company_code").HasMaxLength(10);
            entity.Property(e => e.DivisionCode).HasColumnName("division_code").HasMaxLength(10);
            entity.Property(e => e.LocationCode).HasColumnName("location_code").HasMaxLength(10);
            entity.Property(e => e.PrefixType).HasColumnName("prefix_type").HasMaxLength(4);
            entity.Property(e => e.PrefixCode).HasColumnName("prefix_code").HasMaxLength(4);
            entity.Property(e => e.ContractNumber).HasColumnName("contract_number").HasMaxLength(50);
            entity.Property(e => e.ContractSuffix).HasColumnName("contract_suffix").HasMaxLength(10);
        });

        // Note and TradeUnit entity configuration moved to ApplicationDbContext

        // Configure PlantingIntention entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<PlantingIntention>(entity => { ... });

        // Configure StoredGrain entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<StoredGrain>(entity => { ... });

        // Configure SavedList entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<SavedList>(entity => { ... });
    }
}
