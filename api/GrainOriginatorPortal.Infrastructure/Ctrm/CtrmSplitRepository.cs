using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>A producer's CTRM splits, by customer id.</summary>
public interface ICtrmSplitRepository
{
    /// <summary>"sample" or "ctrm".</summary>
    string Source { get; }

    /// <summary>Null when the customer doesn't exist or has no CTRM code; otherwise the CTRM read, failed or not.</summary>
    Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>?> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
}

public sealed class CtrmSplitRepository : ICtrmSplitRepository
{
    private readonly ApplicationDbContext _appContext;
    private readonly ICtrmSplitReader _reader;
    private readonly ILogger<CtrmSplitRepository> _logger;

    public CtrmSplitRepository(ApplicationDbContext appContext, ICtrmSplitReader reader, ILogger<CtrmSplitRepository> logger)
    {
        _appContext = appContext;
        _reader = reader;
        _logger = logger;
    }

    public string Source => _reader.Source;

    public async Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>?> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var code = await CtrmProducerCode.ResolveAsync(_appContext, _logger, "CTRM splits", customerId, null, cancellationToken);
        return code is null ? null : await _reader.GetForProducerAsync(code, cancellationToken);
    }
}
