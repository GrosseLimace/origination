using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A user-entered contact for a producer: a person (Dad, Son) or an organization (insurance company)
/// with an optional phone and email. A producer can have any number of contacts; exactly one is
/// flagged primary and is mirrored into the legacy ProducerDetails.PrimaryContact/PrimaryPhone
/// columns so customer search and phone-based lookups keep working during the transition.
/// Replaced as a set on upsert (mirrors the ProducerGrainOnFarm child-table pattern).
/// </summary>
public class ProducerContact
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>Stored formatted "(XXX) XXX-XXXX" as entered; search strips punctuation.</summary>
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public bool IsPrimary { get; set; }
    /// <summary>Display order within the producer (primary sorts first regardless).</summary>
    public int SortOrder { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }
}

/// <summary>Composed/flattened contact row carried on <see cref="ProducerDetails.Contacts"/> (read)
/// and passed to the repository upsert (write). Not an EF entity.</summary>
public class ProducerContactEntry
{
    public string Name { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public bool IsPrimary { get; set; }
    public int SortOrder { get; set; }
}
