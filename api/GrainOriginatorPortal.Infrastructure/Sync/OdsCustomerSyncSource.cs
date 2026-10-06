using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// The ODS feeder: today's two ODS reads, unchanged. Every <c>originations.vw_CustomerTradeUnits</c>
/// row becomes one <see cref="CustomerSyncSourceRow"/> (id and trade unit verbatim, attributes copied by
/// <see cref="OdsCustomerSyncAttributes"/>), and the manual customers outside the view (active or not)
/// are looked up in <c>base.vw_CurrentCustomers</c>. A manual customer the master no longer holds is
/// left out of <see cref="CustomerSyncSourceResult.ManualMaster"/> with the master marked complete, so
/// the service deactivates it exactly as before. Read failures propagate, as they always have.
/// </summary>
public sealed class OdsCustomerSyncSource : ICustomerSyncSource
{
    private readonly ICustomerSyncRepository _repository;

    public OdsCustomerSyncSource(ICustomerSyncRepository repository)
    {
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
    }

    public string Name => CustomerSyncSources.Ods;

    public async Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions options, CancellationToken cancellationToken)
    {
        var viewRows = await _repository.LoadOdsTradeUnitRowsAsync(cancellationToken);
        var rows = viewRows
            .Select(v => new CustomerSyncSourceRow { CustomerId = v.CustomerId, TradeUnit = v.TradeUnit, Attributes = new OdsCustomerSyncAttributes(v) })
            .ToList();
        var rowIds = rows.Select(r => r.CustomerId).ToHashSet();

        var manualOutsideView = appState.Customers
            .Where(c => c.IsManual && !rowIds.Contains(c.Id))
            .ToList();

        var manualMaster = new Dictionary<long, CustomerSyncAttributes>();
        if (manualOutsideView.Count > 0)
        {
            var masterRows = await _repository.LoadCurrentCustomerMasterAsync(
                manualOutsideView.Select(c => c.Id).ToList(), cancellationToken);
            // ToDictionary, as the service always did: a duplicate id from the master throws rather than picking one.
            manualMaster = masterRows.ToDictionary(r => r.CustomerId, r => (CustomerSyncAttributes)new OdsCustomerSyncAttributes(r));
        }

        return new CustomerSyncSourceResult { Source = Name, Rows = rows, ManualMaster = manualMaster };
    }
}
