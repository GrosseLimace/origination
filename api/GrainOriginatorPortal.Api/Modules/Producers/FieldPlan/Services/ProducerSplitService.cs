using System.Globalization;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;
using GrainOriginatorPortal.Api.Platform.Exceptions;

namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;

/// <summary>A producer's CTRM splits, the fields a field plan is built from.</summary>
public interface IProducerSplitService
{
    /// <summary>"manual", "sample" or "ctrm" (<c>Ctrm:SplitsSource</c>).</summary>
    string Source { get; }

    Task<ProducerSplitsResponse> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
}

public sealed class ProducerSplitService : IProducerSplitService
{
    private readonly ICtrmSplitRepository _repository;

    public ProducerSplitService(ICtrmSplitRepository repository)
    {
        _repository = repository;
    }

    public string Source => _repository.Source;

    public async Task<ProducerSplitsResponse> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        // SPLITS-GRAPHQL: no list while splits are typed by hand, and no need for the producer's CTRM code.
        if (Source == "manual") return new ProducerSplitsResponse { Source = Source, Splits = [] };

        var read = await _repository.GetByCustomerAsync(customerId, cancellationToken)
            ?? throw new NotFoundException("Producer with a CTRM code", customerId);

        // An empty list would read as "this producer has no fields", so a failed read is an error, not [].
        if (!read.Ok)
            throw new InfrastructureException(
                $"The producer's fields (CTRM splits) could not be read from CTRM ({read.Status}). Please retry shortly.",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE");

        return new ProducerSplitsResponse
        {
            Source = _repository.Source,
            Splits = (read.Value ?? []).Select(s => new ProducerSplitResponse
            {
                SplitId = s.SplitId,
                PrimaryCustomerId = s.PrimaryCustomerId,
                Name = s.Name,
                FieldName = s.FieldName,
                SplitPercent = s.SplitPercent,
                EffectiveDate = s.EffectiveDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Expired = s.Expired,
                Kind = s.Kind.ToString(),
            }).ToList(),
        };
    }
}
