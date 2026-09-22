namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Result of moving a producer's planting intentions between trade units.</summary>
public record RetagPlantingIntentionsResponse
{
    /// <summary>How many rows were repointed at the new trade unit.</summary>
    public int Moved { get; init; }
}
