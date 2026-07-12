using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Field-tagging POC (see docs/maps/field-tagging). Tolerates the feature being unconfigured
/// (no FieldTags:LocalStorePath): reads degrade to empty results, mutations throw a
/// FIELD_TAGS_DISABLED BusinessException.
/// </summary>
public interface IFieldTagService
{
    Task<List<FieldTagResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<FieldTagResponse> CreateAsync(long customerId, CreateFieldTagRequest request, CancellationToken cancellationToken);
    Task DeleteAsync(long customerId, int id, CancellationToken cancellationToken);
    Task<ApplyCalculatedAcresResponse> ApplyCalculatedAcresAsync(long customerId, CancellationToken cancellationToken);
}
