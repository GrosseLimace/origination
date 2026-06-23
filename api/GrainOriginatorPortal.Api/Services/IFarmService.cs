using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Farm / field locations. (No ODS table yet — the underlying repository is a stub.)</summary>
public interface IFarmService
{
    Task<List<FarmResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<FarmResponse?> GetByIdAsync(string id, CancellationToken cancellationToken);
    Task<List<FarmResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<string> CreateAsync(string name, string location, int acres, CancellationToken cancellationToken);
}
