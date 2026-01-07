namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents grain stored at a facility on behalf of a customer.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Link to facility/bin location
/// - Add storage rate and billing information
/// - Track quality degradation over time
/// - Add lot/sublot tracking for traceability
/// </remarks>
public class StoredGrain
{
    /// <summary>
    /// Unique identifier for the stored grain record.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Customer entity.
    /// </summary>
    public string CustomerId { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Farm entity (source of the grain).
    /// </summary>
    public string FarmId { get; set; } = string.Empty;

    /// <summary>
    /// Type of commodity stored.
    /// </summary>
    public string Crop { get; set; } = string.Empty;

    /// <summary>
    /// Quantity in storage (bushels).
    /// </summary>
    public int Quantity { get; set; }

    /// <summary>
    /// Date when grain entered storage.
    /// </summary>
    public DateTime StorageStartDate { get; set; }

    /// <summary>
    /// Monthly storage rate per bushel.
    /// </summary>
    /// <remarks>TODO: Link to rate schedule based on commodity and agreement</remarks>
    public decimal StorageRate { get; set; }

    /// <summary>
    /// Bin or location identifier where grain is stored.
    /// </summary>
    public string Bin { get; set; } = string.Empty;

    #region Computed Properties

    /// <summary>
    /// Alias for Quantity - returns bushels in storage.
    /// </summary>
    public int Bushels => Quantity;

    /// <summary>
    /// Alias for StorageStartDate - returns when grain was received.
    /// </summary>
    public DateTime DateReceived => StorageStartDate;

    /// <summary>
    /// Calculates the accumulated storage cost based on time in storage.
    /// </summary>
    /// <remarks>
    /// TODO: This calculation should be done server-side with proper billing rules.
    /// Consider partial month proration and minimum charges.
    /// </remarks>
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

    #endregion
}