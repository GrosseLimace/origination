namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a commodity harvest-delivery window. Entity-shaped (Decision 1).</summary>
public record HarvestWindowResponse
{
    public int Id { get; init; }
    public string Commodity { get; init; } = string.Empty;
    public int DeliveryStartMonth { get; init; }
    public int DeliveryStartDay { get; init; }
    public int DeliveryEndMonth { get; init; }
    public int DeliveryEndDay { get; init; }
    public bool IsActive { get; init; } = true;
}
