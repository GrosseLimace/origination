using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Receives one producer's NOP certification from the integration, validates it and files it.
/// </summary>
public interface IOrganicCertificationIngestService
{
    /// <summary>
    /// Files one producer's certification. Safe to retry: the operation upserts on NOP id and its
    /// scopes and items are replaced as a set, so re-sending the same message converges rather
    /// than duplicating.
    /// </summary>
    Task<OrganicCertificationIngestResponse> IngestAsync(
        OrganicCertificationIngestRequest request,
        CancellationToken cancellationToken = default);
}
