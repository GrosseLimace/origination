using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Planting intentions. List reads are scoped to the caller's entitled trade units. Create and
/// Update derive the customer name/code from the DB and keep the caller's chosen trade unit only when it
/// is one of the producer's active memberships (a data-integrity rule, not an access check — AR-01/AR-02).</summary>
public interface IPlantingIntentionService
{
    Task<List<PlantingIntentionResponse>> GetAllAsync(string? tradeUnits, int? plantingYear, CancellationToken cancellationToken);
    Task<List<PlantingIntentionResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<PlantingIntentionResponse?> GetByIdAsync(int intentionId, CancellationToken cancellationToken);

    /// <summary>Creates a planting intention. Throws ValidationException when the supplied trade unit is
    /// not one of the producer's, or when none was supplied and none can be derived for the customer.</summary>
    Task<PlantingIntentionResponse> CreateAsync(long customerId, string? customerName, string? customerCode,
        string? tradeUnit, string crop, string? category, string? type, string? description, int acres,
        int plantingYear, CancellationToken cancellationToken);

    /// <summary>Updates a planting intention. <paramref name="tradeUnit"/> null/blank leaves the stored
    /// trade unit unchanged; otherwise it must be one of the producer's active trade units.</summary>
    Task<PlantingIntentionResponse?> UpdateAsync(int intentionId, string crop, string? category, string? type,
        string? description, int acres, int plantingYear, string? tradeUnit, CancellationToken cancellationToken);

    Task DeleteAsync(int intentionId, CancellationToken cancellationToken);
}
