using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// The three CTRM reads a keep-warm cycle issues per producer set, behind a seam.
/// </summary>
/// <remarks>
/// <see cref="CtrmContractReader"/> and <see cref="CtrmTicketReader"/> are sealed classes with no
/// interface, which is right for them: they are the one implementation and nothing else should
/// pretend to be a reader. But it left the keep-warm cycle's failure isolation untestable, because
/// nothing could stand in for a reader that fails for one set and answers for the next. This
/// interface is that stand-in. Public only because the service's public constructor takes it; it exists for
/// the cycle alone, and production wires the single adapter
/// below and never sees the difference.
/// </remarks>
public interface ICtrmWarmReads
{
    Task<CtrmReadResult<List<CtrmContractDto>>> ContractsAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken);
    Task<CtrmReadResult<List<CtrmTicketDto>>> TicketHistoryAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken);
    Task<CtrmReadResult<List<CtrmTicketDto>>> SpotLoadsAsync(IReadOnlyCollection<string> codes, DateTime from, DateTime to, CancellationToken cancellationToken);
}

/// <summary>Production adapter: delegates each read to the real reader, unchanged.</summary>
internal sealed class CtrmWarmReads(CtrmContractReader contracts, CtrmTicketReader tickets) : ICtrmWarmReads
{
    public Task<CtrmReadResult<List<CtrmContractDto>>> ContractsAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken)
        => contracts.GetForProducersAsync(codes, cancellationToken);

    public Task<CtrmReadResult<List<CtrmTicketDto>>> TicketHistoryAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken)
        => tickets.GetForProducersHistoryAsync(codes, cancellationToken);

    public Task<CtrmReadResult<List<CtrmTicketDto>>> SpotLoadsAsync(IReadOnlyCollection<string> codes, DateTime from, DateTime to, CancellationToken cancellationToken)
        => tickets.GetForProducersAsync(codes, from, to, cancellationToken);
}
