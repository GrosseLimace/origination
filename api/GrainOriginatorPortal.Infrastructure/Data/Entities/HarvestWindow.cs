namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Defines the expected delivery window for a commodity in a given planting year.
/// Used to match contracts to planting intentions by delivery date instead of crop year.
/// E.g., Wheat planted in 2026 is harvested June-July 2026, so contracts delivering
/// in that window count toward the 2026 wheat planting contracted bushels.
/// </summary>
public class HarvestWindow
{
    public int Id { get; set; }

    /// <summary>Broad commodity name: WHEAT, CORN, SORGHUM, SOYBEANS, CANOLA</summary>
    public string Commodity { get; set; } = string.Empty;

    /// <summary>Delivery window start month (1-12). Combined with planting year to get full date.</summary>
    public int DeliveryStartMonth { get; set; }

    /// <summary>Delivery window start day.</summary>
    public int DeliveryStartDay { get; set; }

    /// <summary>Delivery window end month (1-12).</summary>
    public int DeliveryEndMonth { get; set; }

    /// <summary>Delivery window end day.</summary>
    public int DeliveryEndDay { get; set; }

    public bool IsActive { get; set; } = true;
}
