namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a delivery ticket for grain received at a facility.
/// Maps to the Ticket table in the ODS database.
/// </summary>
public class Ticket
{
    // Primary key - maps to TicketId (bigint)
    public long Id { get; set; }

    // Foreign keys
    public long? ContractId { get; set; }
    public long? CustomerId { get; set; }
    public string FarmId { get; set; } = string.Empty;

    // Source identifiers
    public long? SourceTicketHeaderId { get; set; }
    public long? SourceTicketDetailId { get; set; }
    public string? CustomerCode { get; set; } // Maps to CustomerCode - used for string matching with Customer.SourceCustomerId

    // Ticket identifiers
    public string? ProductCode { get; set; }
    public string? TicketPrefix { get; set; }
    public string TicketNumber { get; set; } = string.Empty;
    public string? TicketSuffix { get; set; }
    public string? ShipmentTicketNumber { get; set; } // Full shipment ticket number from ODS
    public string? CtrmContractNumber { get; set; }

    // Organization / trade unit
    public string? OrganizationCode { get; set; }

    // Elevator / location
    public string? ElevatorCode { get; set; }
    public string? UnloadOrganizationCode { get; set; }
    public string? ElevatorCity { get; set; }   // Populated from vw_GNP026 join
    public string? ElevatorState { get; set; }  // Populated from vw_GNP026 join

    // Dates - different types in ODS view
    public string? Date { get; set; } // Maps to TicketBlDate (stored as string in DB)
    public DateTime? FinalSettledDate { get; set; } // Stored as DateTime in DB

    // Computed — used for chronological sorting since Date is stored as a string
    public DateTime? ParsedDate => DateTime.TryParse(Date, out var d) ? d : null;

    // Quantities (various types in ODS)
    public decimal? UnloadQuantity { get; set; }
    public decimal? LoadoutQuantity { get; set; }
    public long? AppliedDockQuantity { get; set; } // Maps to AppliedNetQuantity (bigint in ODS)
    public decimal? AppliedQuantity { get; set; }
    public int GrossWeight { get; set; }
    public int TareWeight { get; set; }
    public int NetWeight { get; set; }

    // Quality measures
    public decimal? Moisture { get; set; } // Maps to MoisturePercent
    public decimal? TestWeight { get; set; } // Maps to TestWeightPercent
    public decimal? ProteinPercent { get; set; }
    public string? GradeCode { get; set; }

    // Classification — maps to GNP014.BCPFXT via ODS TicketType column
    public string? TicketType { get; set; } // P=Purchase, S=Sale, U=Unload, L=Loadout, B=Booking

    // A ticket is applied when its contract prefix (first char of CtrmContractNumber) is P or S.
    // CtrmContractNumber is built from ODS BCPFXC (prefix) + BCNTNO (number).
    // This is more reliable than TicketType alone — a U-type ticket can legitimately be applied
    // to a contract, but the contract prefix is the authoritative indicator.
    // [JsonInclude] required because System.Text.Json skips getter-only properties by default.
    [System.Text.Json.Serialization.JsonInclude]
    public bool IsApplied =>
        CtrmContractNumber is { Length: > 0 } &&
        (CtrmContractNumber[0] == 'P' || CtrmContractNumber[0] == 'S');

    // Status
    public string? TicketStatusDescription { get; set; } // e.g. "Unload", "Final Settled", "P/A"
    public bool IsActive { get; set; }
}
