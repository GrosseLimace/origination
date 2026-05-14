using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Bidirectional link between two customers (producers). One row per
/// directed (From, To) pair. Replaces the comma-separated
/// ProducerDetails.LinkedProducerIds anti-pattern with a proper join table
/// that can be FK-enforced and indexed for reverse lookups.
///
/// The semantic is: "FromCustomer has linked ToCustomer as a related producer."
/// Reverse links are NOT auto-created — Producer A linking Producer B does
/// not imply Producer B linking Producer A. Callers that want the full
/// component (e.g. the home page's getLinkedGroup BFS) walk forward + reverse
/// edges from this table.
/// </summary>
public class CustomerLink
{
    public int Id { get; set; }
    public long FromCustomerId { get; set; }
    public long ToCustomerId { get; set; }

    // Navigation properties — populated via Include() when needed.
    // [JsonIgnore] keeps the full Customer rows out of API responses.
    [JsonIgnore]
    public Customer? FromCustomer { get; set; }
    [JsonIgnore]
    public Customer? ToCustomer { get; set; }
}
