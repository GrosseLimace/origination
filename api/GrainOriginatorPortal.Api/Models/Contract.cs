namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a grain purchase contract with a customer.
/// </summary>
public class Contract
{
    public string Id { get; set; } = string.Empty;
    public string CustomerId { get; set; } = string.Empty;
    public string FarmId { get; set; } = string.Empty;
    public string ContractNumber { get; set; } = string.Empty;
    public string Crop { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public string Unit { get; set; } = "bushels";
    public decimal Price { get; set; }
    public DateTime DeliveryStart { get; set; }
    public DateTime DeliveryEnd { get; set; }
    public ContractStatus Status { get; set; } = ContractStatus.Pending;
    public bool Signed { get; set; }
}
