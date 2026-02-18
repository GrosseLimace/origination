using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a customer (farmer/producer) in the grain origination system.
/// Maps to the Customer table in the ODS database.
/// </summary>
public class Customer
{
    // Primary key - maps to CustomerId (bigint)
    public long Id { get; set; }

    // Core customer fields from ODS
    public string? SourceCustomerId { get; set; }
    public string? CustomerCode { get; set; }
    public string Name { get; set; } = string.Empty; // Maps to CustomerName

    // Contact information (nullable - may not be available for all customers)
    public string? Location { get; set; } // Maps to MerchandisingCity
    public string? StateProvince { get; set; } // Maps to MerchandisingStateProvince
    public string? AddressLine1 { get; set; }  // Maps to MerchandisingAddressLine1
    public string? PostalCode { get; set; }    // Maps to MerchandisingPostalCode
    public string? Phone { get; set; } // Maps to MerchandisingPhone
    public string? Email { get; set; } // Maps to MerchandisingEmail
    public string? ExtendedPrimaryPhone { get; set; } // Fallback phone number
    public string? SupplementalEmail { get; set; } // Fallback email

    // Additional fields
    public int TotalAcres { get; set; }
    public List<string> FarmIds { get; set; } = new();

    [JsonPropertyName("linkedProducerIds")]
    public List<string> LinkedProducerIds { get; set; } = new();

    public bool ESignEnabled { get; set; }
    public Coordinates? Coordinates { get; set; }

    // ODS metadata fields
    public string Farm { get; set; } = string.Empty;
    public string? IndustryCode1 { get; set; } // Used to filter producer customers (PR)
    public bool IsActive { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }
}
