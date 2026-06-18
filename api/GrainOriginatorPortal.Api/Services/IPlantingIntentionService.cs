using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Planting intentions. List reads are scoped to the caller's entitled trade units; Create
/// derives the authoritative customer name/code/trade-unit from the DB rather than trusting the client.</summary>
public interface IPlantingIntentionService
{
    Task<List<PlantingIntentionResponse>> GetAllAsync(string? tradeUnits, int? plantingYear, CancellationToken cancellationToken);
    Task<List<PlantingIntentionResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<PlantingIntentionResponse?> GetByIdAsync(int intentionId, CancellationToken cancellationToken);

    /// <summary>Creates a planting intention. Throws ValidationException when no trade unit can be
    /// determined for the customer (neither a server-side membership nor a client-supplied value).</summary>
    Task<PlantingIntentionResponse> CreateAsync(long customerId, string? customerName, string? customerCode,
        string? tradeUnit, string crop, string? category, string? type, string? description, int acres,
        int plantingYear, CancellationToken cancellationToken);

    Task<PlantingIntentionResponse?> UpdateAsync(int intentionId, string crop, string? category, string? type,
        string? description, int acres, int plantingYear, CancellationToken cancellationToken);

    Task DeleteAsync(int intentionId, CancellationToken cancellationToken);
}
