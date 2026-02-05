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
    // Only Customer, Contract, and Ticket exist in ODS currently
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Ticket> Tickets => Set<Ticket>();

    // These tables don't exist in ODS - will return empty data
    // public DbSet<Farm> Farms => Set<Farm>();
    // public DbSet<PlantingIntention> PlantingIntentions => Set<PlantingIntention>();
    // public DbSet<Note> Notes => Set<Note>();
    // public DbSet<StoredGrain> StoredGrains => Set<StoredGrain>();
    // public DbSet<SavedList> SavedLists => Set<SavedList>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Configure Customer entity - Maps to ODS vw_CurrentCustomers view in base schema
        modelBuilder.Entity<Customer>(entity =>
        {
            entity.ToView("vw_CurrentCustomers", schema: "base"); // View that filters for current customers only
            entity.HasKey(e => e.Id);

            // Map to vw_CurrentCustomers column names (PascalCase in base schema views)
            entity.Property(e => e.Id).HasColumnName("CustomerId").IsRequired();
            entity.Property(e => e.Name).HasColumnName("CustomerName").HasMaxLength(500);

            // Contact information from view - map to extended contact columns (nullable)
            entity.Property(e => e.Phone).HasColumnName("ExtendedPrimaryPhone").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.Email).HasColumnName("AccountingExtendedEmail").HasMaxLength(255).IsRequired(false);
            entity.Property(e => e.Location).HasColumnName("ExtendedCity").HasMaxLength(255).IsRequired(false);

            // Map available ODS metadata fields
            entity.Property(e => e.SourceCustomerId).HasColumnName("SourceCustomerId").HasMaxLength(400);
            entity.Property(e => e.IsCurrent).HasColumnName("IsCurrent").IsRequired();
            entity.Property(e => e.EffectiveStartDate).HasColumnName("EffectiveStartDate");
            entity.Property(e => e.EffectiveEndDate).HasColumnName("EffectiveEndDate");

            // Not mapped to ODS (application-specific fields)
            entity.Ignore(e => e.CustomerCode);
            entity.Ignore(e => e.Farm);
            entity.Ignore(e => e.TotalAcres);
            entity.Ignore(e => e.ESignEnabled);
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
            entity.ToView("vw_CurrentContracts", schema: "base"); // View that filters for current contracts only
            entity.HasKey(e => e.Id);

            // Map to ODS column names - essential fields for displaying contracts
            entity.Property(e => e.Id).HasColumnName("ContractId").IsRequired();
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId"); // FK to Customer
            entity.Property(e => e.SourceContractId).HasColumnName("SourceContractId").HasMaxLength(64).IsRequired(false);
            entity.Property(e => e.ContractNumber).HasColumnName("ContractNumber").HasMaxLength(100).IsRequired(false);

            // Customer and commodity info
            entity.Property(e => e.CustomerName).HasColumnName("CustomerName").HasMaxLength(500).IsRequired(false);
            entity.Property(e => e.CommodityCode).HasColumnName("CommodityCode").HasMaxLength(100).IsRequired(false);
            entity.Property(e => e.CommodityDescription).HasColumnName("CommodityDescription").HasMaxLength(255).IsRequired(false);

            // Quantity and pricing - mapped to actual ODS column names
            entity.Property(e => e.Quantity).HasColumnName("Quantity").HasColumnType("decimal(18,6)").IsRequired(false);
            entity.Property(e => e.Unit).HasColumnName("QuantityUom").HasMaxLength(16).IsRequired(false);

            // Price field doesn't exist in view - ignore it for now
            entity.Ignore(e => e.Price);

            // Dates - mapped to actual ODS column names
            entity.Property(e => e.ContractDate).HasColumnName("ContractDate").HasColumnType("date").IsRequired(false);
            entity.Property(e => e.DeliveryStart).HasColumnName("StartShipDate").HasColumnType("date").IsRequired(false);
            entity.Property(e => e.DeliveryEnd).HasColumnName("FinalShipDate").HasColumnType("date").IsRequired(false);
            entity.Property(e => e.ClosedDate).HasColumnName("ClosedDate").HasColumnType("date").IsRequired(false);

            // Metadata
            entity.Property(e => e.IsCurrent).HasColumnName("IsCurrent").IsRequired();
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
            entity.ToView("vw_CurrentTickets", schema: "base"); // View that filters for current tickets only
            entity.HasKey(e => e.Id);

            // Map to ODS column names - only the fields that exist
            entity.Property(e => e.Id).HasColumnName("TicketId").IsRequired();
            entity.Property(e => e.ContractId).HasColumnName("ContractId");
            entity.Property(e => e.CustomerId).HasColumnName("CustomerId");
            entity.Property(e => e.SourceTicketHeaderId).HasColumnName("SourceTicketHeaderId");
            entity.Property(e => e.SourceTicketDetailId).HasColumnName("SourceTicketDetailId");

            // Ticket identifiers
            entity.Property(e => e.ProductCode).HasColumnName("ProductCode").HasMaxLength(100);
            entity.Property(e => e.TicketPrefix).HasColumnName("TicketPrefix").HasMaxLength(100);
            entity.Property(e => e.TicketNumber).HasColumnName("TicketNumber").HasMaxLength(100);
            entity.Property(e => e.TicketSuffix).HasColumnName("TicketSuffix").HasMaxLength(100);
            entity.Property(e => e.CtrmContractNumber).HasColumnName("CtrmContractNumber").HasMaxLength(100);

            // Dates
            entity.Property(e => e.Date).HasColumnName("TicketDate").HasColumnType("date");
            entity.Property(e => e.FinalSettledDate).HasColumnName("FinalSettledDate").HasColumnType("date");

            // Quantities
            entity.Property(e => e.UnloadQuantity).HasColumnName("UnloadQuantity").HasColumnType("decimal(18,6)");
            entity.Property(e => e.LoadoutQuantity).HasColumnName("LoadoutQuantity").HasColumnType("decimal(18,6)");
            // Note: AppliedDockQuantity is bigint in ODS, not decimal
            entity.Property(e => e.AppliedDockQuantity).HasColumnName("AppliedDockQuantity");
            // AppliedQuantity doesn't exist in ODS - ignore it
            entity.Ignore(e => e.AppliedQuantity);

            // Quality measures
            entity.Property(e => e.Moisture).HasColumnName("MoisturePercent").HasPrecision(5, 2);
            entity.Property(e => e.TestWeight).HasColumnName("TestWeightPercent").HasPrecision(5, 2);
            entity.Property(e => e.ProteinPercent).HasColumnName("ProteinPercent").HasPrecision(5, 2);

            // Status
            entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true);

            // Not mapped to ODS (application-specific fields)
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

        // Configure PlantingIntention entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<PlantingIntention>(entity => { ... });

        // Configure Note entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<Note>(entity => { ... });

        // Configure StoredGrain entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<StoredGrain>(entity => { ... });

        // Configure SavedList entity - DISABLED: Table doesn't exist in ODS
        // modelBuilder.Entity<SavedList>(entity => { ... });
    }
}
