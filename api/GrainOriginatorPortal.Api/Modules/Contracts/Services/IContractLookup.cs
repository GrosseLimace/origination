namespace GrainOriginatorPortal.Api.Modules.Contracts.Services;

/// <summary>
/// What other modules may ask the Contracts module about contracts. They use this instead of the Contracts
/// repositories, so the ODS/CTRM switch and the contract rules stay in one place.
/// </summary>
public interface IContractLookup
{
    /// <summary>
    /// The contract number and commodity of each of <paramref name="contractIds"/> found in ODS, for reports that name
    /// the contracts people opened. These are ODS surrogate ids; an id ODS never had, such as one CTRM manufactured, is
    /// left out like any unknown id.
    /// </summary>
    Task<Dictionary<long, ContractName>> GetNamesAsync(IReadOnlyCollection<long> contractIds, CancellationToken cancellationToken);
}

/// <summary>A contract's number and commodity code.</summary>
public sealed record ContractName(string ContractNumber, string? CommodityCode);
