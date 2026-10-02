using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Routes contract reads to either the ODS or the CTRM repository based on <c>Ctrm:Source</c>.
/// </summary>
/// <remarks>
/// <para>The flag is read on <b>every call</b>, not captured at construction. That is deliberate:
/// <c>appsettings</c> is registered with change-tracking, so editing <c>Ctrm:Source</c> switches the
/// source without restarting the API. Comparing ODS against CTRM for the same producer is the entire
/// point of this spike, and a restart between each comparison would make it painful enough to skip.</para>
///
/// <para>Anything other than the literal <c>ctrm</c> means ODS, so an empty, absent or misspelled
/// value leaves behaviour unchanged. The unfamiliar source has to be asked for explicitly.</para>
///
/// <para>Since 2026-10-01 the environment value is the <b>default</b>, not the whole answer: a user named
/// in <c>Ctrm:SourceToggleUsers</c> who sent an <c>X-Data-Source-Preference</c> header gets the source
/// they asked for, via the request's <see cref="CtrmSourceChoice"/>. That is how CTRM is validated against
/// ODS on production data by a few testers while everyone else stays on the default. The rule itself
/// lives in <see cref="CtrmSourceChoice.Resolve(IConfiguration, string?, string?)"/>.</para>
/// </remarks>
public sealed class ContractRepositorySwitch : IContractRepository
{
    /// <summary>The one value that routes reads to CTRM.</summary>
    public const string CtrmSourceValue = CtrmSourceChoice.Ctrm;

    private readonly ContractRepository _ods;
    private readonly CtrmContractRepository _ctrm;
    private readonly IConfiguration _configuration;
    private readonly CtrmProvenance _provenance;
    private readonly CtrmSourceChoice _choice;

    public ContractRepositorySwitch(
        ContractRepository ods,
        CtrmContractRepository ctrm,
        IConfiguration configuration,
        CtrmProvenance provenance,
        CtrmSourceChoice? choice = null)
    {
        _ods = ods;
        _ctrm = ctrm;
        _configuration = configuration;
        _provenance = provenance;
        // Optional so background scopes and existing tests that never see a request still resolve to the
        // environment default: an empty choice has no user and no preference.
        _choice = choice ?? new CtrmSourceChoice();
    }

    /// <summary>True when contract reads for THIS request are pointed at CTRM.</summary>
    public bool UsingCtrm => _choice.UsesCtrm(_configuration);

    /// <summary>
    /// The repository this call routes to, recording the choice for the provenance header.
    /// </summary>
    private IContractRepository Active
    {
        get
        {
            var useCtrm = UsingCtrm;
            _provenance.RecordSource(useCtrm ? CtrmSourceValue : "ods");
            return useCtrm ? _ctrm : _ods;
        }
    }

    public Task<List<Contract>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => Active.GetAsync(tradeUnits, cancellationToken);

    public Task<List<Contract>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
        => Active.GetByCustomerAsync(customerId, scoularId, cancellationToken);

    public Task<List<Contract>> GetHistoricalForPacingAsync(long customerId, CancellationToken cancellationToken)
        => Active.GetHistoricalForPacingAsync(customerId, cancellationToken);

    public Task<List<Contract>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken)
        => Active.GetByCropYearAsync(cropYear, tradeUnits, cancellationToken);

    public Task<List<Contract>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => Active.GetByFarmAsync(farmId, cancellationToken);

    public Task<List<Contract>> GetBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken)
        => Active.GetBySourceIdAsync(sourceContractId, cancellationToken);

    public Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken)
        => Active.GetPricingLinesAsync(sourceContractId, cancellationToken);

    public Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken)
        => Active.GetPricingLinesByCustomerAsync(scoularId, cancellationToken);
}
