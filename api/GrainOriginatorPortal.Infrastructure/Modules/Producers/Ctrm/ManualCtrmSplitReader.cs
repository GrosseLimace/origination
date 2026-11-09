using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;


namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;

/// <summary>
/// SPLITS-GRAPHQL: TEMPORARY. No split list at all: originators type each field's split ID, name and share by
/// hand (stored with SplitSource "Manual"). Used for go-live because CTRM's splits query isn't ready; once it
/// is, switch <c>Ctrm:SplitsSource</c> to <c>ctrm</c> (see docs/45z/README.md, "Switching to the CTRM splits
/// query"). Selected by <c>Ctrm:SplitsSource</c> = <c>manual</c>, the default.
/// </summary>
public sealed class ManualCtrmSplitReader : ICtrmSplitReader
{
    public string Source => "manual";

    public Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>> GetForProducerAsync(string producerCode, CancellationToken cancellationToken) =>
        Task.FromResult(new CtrmReadResult<IReadOnlyList<CtrmSplit>> { Status = CtrmReadStatus.Ok, Value = [] });
}
