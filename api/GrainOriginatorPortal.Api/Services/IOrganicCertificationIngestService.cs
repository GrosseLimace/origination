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

    /// <summary>
    /// Records that the sender deliberately did NOT send a certification for a producer it
    /// considered in a run.
    ///
    /// Stores no certification — it writes one audit row so that producer's position in the run is
    /// filled. Without it a deliberate skip and a message lost in transit are the same thing: a
    /// missing position.
    ///
    /// Safe to retry: a re-sent notice writes another audit row, and the completeness check counts
    /// DISTINCT positions rather than rows.
    /// </summary>
    Task<OrganicCertificationSkipResponse> RecordSkipAsync(
        OrganicCertificationSkipRequest request,
        CancellationToken cancellationToken = default);
}
