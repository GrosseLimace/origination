namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents grain stored at a facility on behalf of a customer.
/// </summary>
public class StoredGrain
{
    public string Id { get; set; } = string.Empty;
    public string CustomerId { get; set; } = string.Empty;
    public string FarmId { get; set; } = string.Empty;
    public string Crop { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public DateTime StorageStartDate { get; set; }
    public decimal StorageRate { get; set; }
    public string Bin { get; set; } = string.Empty;

    // Computed properties
    public int Bushels => Quantity;
    public DateTime DateReceived => StorageStartDate;
    public decimal AccumulatedStorageCost
    {
        get
        {
            var monthsStored = (DateTime.Now.Year - StorageStartDate.Year) * 12
                             + (DateTime.Now.Month - StorageStartDate.Month)
                             + (DateTime.Now.Day / 30.0);
            return (decimal)monthsStored * StorageRate * Quantity;
        }
    }
}
