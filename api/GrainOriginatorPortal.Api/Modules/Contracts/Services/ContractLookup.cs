// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Repositories;

namespace GrainOriginatorPortal.Api.Modules.Contracts.Services;

/// <inheritdoc cref="IContractLookup"/>
/// <remarks>Reads the ODS repository directly rather than through the switch: the ids are ODS ids.</remarks>
public sealed class ContractLookup(ContractRepository ods) : IContractLookup
{
    public async Task<Dictionary<long, ContractName>> GetNamesAsync(IReadOnlyCollection<long> contractIds, CancellationToken cancellationToken) =>
        (await ods.GetNamesAsync(contractIds, cancellationToken))
            .ToDictionary(c => c.Key, c => new ContractName(c.Value.ContractNumber, c.Value.CommodityCode));
}
