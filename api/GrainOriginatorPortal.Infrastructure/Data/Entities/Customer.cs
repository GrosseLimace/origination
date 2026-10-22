using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Represents a customer (farmer/producer) in the grain origination system.
/// Maps to the Customer table in the ODS database.
/// </summary>
public class Customer
{
    // Primary key - maps to CustomerId (bigint)
    public long Id { get; set; }

    // Core customer fields from ODS
    public string? ScoularId { get; set; }
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

    // Extended address fields — more accurate location data for geocoding
    public string? ExtendedAddressLine1 { get; set; }
    public string? ExtendedAddressLine2 { get; set; }
    public string? ExtendedAddressLine3 { get; set; }
    public string? ExtendedAddressLine4 { get; set; }
    public string? ExtendedCity { get; set; }
    public string? ExtendedPostalCode { get; set; }
    public string? ExtendedStateProvince { get; set; }
    public string? ExtendedCountry { get; set; }

    // Additional fields
    public int TotalAcres { get; set; }
    public List<string> FarmIds { get; set; } = new();

    [JsonPropertyName("linkedProducerIds")]
    public List<string> LinkedProducerIds { get; set; } = new();

    public bool ESignEnabled { get; set; }
    public string? ScoularViewRecipients { get; set; }  // Comma-separated "Name | email/phone", populated from dbo.eSignEnrollment
    public string? Guild { get; set; }                   // Guild name, populated from dbo.eSignEnrollment
    // ACH-enabled = PaymentMethod code 'H'. Transient (not a dbo.Customer column); enriched at read
    // time like ESignEnabled — from ODS base.Customer on the ods sync source, from the PaymentMethod
    // column below on the ctrm source (plan E2).
    public bool AchEnabled { get; set; }

    /// <summary>
    /// The CTRM payment method code (dbo.Customer.PaymentMethod, nvarchar(10)), written by the customer sync on
    /// the ctrm source only while CustomerSync:CtrmExtendedFields is on; otherwise null (or the value of the last
    /// extended run), and never written by the ods source. Server-side only: the client reads <see cref="AchEnabled"/>.
    /// </summary>
    [JsonIgnore]
    public string? PaymentMethod { get; set; }

    /// <summary>Length of dbo.Customer.PaymentMethod.</summary>
    public const int PaymentMethodMaxLength = 10;
    // The producer's active trade-unit codes, from dbo.CustomerTradeUnit. Transient; enriched on the
    // list reads so the planting dialog can offer them without a request of its own.
    public List<string> ActiveTradeUnits { get; set; } = new();
    public Coordinates? Coordinates { get; set; }

    // ODS metadata fields
    public string Farm { get; set; } = string.Empty;
    public string? IndustryCode1 { get; set; } // Used to filter producer customers (PR)
    public string? IndustryCode2 { get; set; }  // 'OR' marks a certified-organic operation
    public string? NopIdNumber { get; set; }    // National Organic Program operation id ('0' placeholders normalised to null)
    public bool IsActive { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }

    // True when a user onboarded this customer manually (assigned trade units from the app)
    // rather than the customer arriving via the nightly CustomerSyncService. The sync's
    // soft-delete pass skips IsManual rows so manual onboarding survives nightly runs.
    public bool IsManual { get; set; }
}
