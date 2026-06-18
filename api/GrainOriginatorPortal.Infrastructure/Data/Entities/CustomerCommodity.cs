using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Join table linking a customer to one of the commodities they grow.
/// Replaces the comma-separated ProducerDetails.Commodities CSV with a
/// proper many-to-many that FK-enforces commodity codes against the
/// dbo.Commodities lookup table.
/// </summary>
public class CustomerCommodity
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public int CommodityId { get; set; }

    // Navigation properties — populated via Include() when needed.
    // [JsonIgnore] keeps them out of API responses (the API exposes the
    // CSV of commodity codes on ProducerDetails, composed from these rows).
    [JsonIgnore]
    public Customer? Customer { get; set; }
    [JsonIgnore]
    public Commodity? Commodity { get; set; }
}
