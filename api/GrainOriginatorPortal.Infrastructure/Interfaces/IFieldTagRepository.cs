using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for field tags (POC-only, backed by FieldTagDbContext / local SQLite). Only
/// registered when the field-tagging feature is configured — see FieldTagsPocDependencyInjection.
/// </summary>
public interface IFieldTagRepository
{
    Task<List<CustomerFieldTag>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<CustomerFieldTag?> GetActiveByExternalRefAsync(long customerId, string externalRef, CancellationToken cancellationToken);
    Task<CustomerFieldTag?> GetActiveByIdAsync(long customerId, int id, CancellationToken cancellationToken);
    Task<CustomerFieldTag> AddAsync(CustomerFieldTag tag, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(long customerId, int id, string currentUser, CancellationToken cancellationToken);
}
