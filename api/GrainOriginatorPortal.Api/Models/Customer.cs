using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a customer (farmer/producer) in the grain origination system.
/// </summary>
public class Customer
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Farm { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public int TotalAcres { get; set; }
    public List<string> FarmIds { get; set; } = new();

    [JsonPropertyName("linkedProducerIds")]
    public List<string> LinkedProducerIds { get; set; } = new();

    public bool ESignEnabled { get; set; }
    public Coordinates? Coordinates { get; set; }
}
