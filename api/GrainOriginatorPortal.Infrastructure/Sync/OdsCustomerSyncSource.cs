// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data.Entities;
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
/// <remarks>
/// <para><b>Adopting CTRM-minted rows.</b> While <c>CustomerSync:Source</c> is <c>ctrm</c>, producers that exist
/// only in CTRM get ids minted in the band of <see cref="CustomerIdMinting"/>. If the source is later flipped back
/// to <c>ods</c>, the view carries the same producer under its ODS id, which the app has never held. Inserting that
/// id would create a second customer and split the producer's notes, contacts and saved lists across two ids.
/// So a view row whose ODS id is unknown to the app, but whose <c>ScoularId</c> (trimmed, case-insensitive)
/// matches a minted row, is re-keyed to the minted id. When several minted rows share the code, the active one
/// wins, then the lowest id: the same tie-break onboarding uses when it adopts by <c>ScoularId</c>
/// (<c>CustomerRepository.AssignTradeUnitsAsync</c>). A view row whose ODS id the app already holds is never
/// re-keyed, and rows the app holds under a non-minted id are never adopted here.</para>
///
/// <para>This adoption is what makes flipping back to <c>ods</c> a safe rollback once minted ids carry notes
/// (plan D5, §11 Q7). It must stay for as long as that reversibility is wanted.</para>
///
/// <para>Minted manual customers outside the view cannot be looked up in <c>base.vw_CurrentCustomers</c> (which
/// is keyed by ODS id), so they are reported as <see cref="CustomerSyncSourceResult.ManualUnverifiable"/>:
/// never refreshed and never deactivated by an ODS run.</para>
/// </remarks>
public sealed class OdsCustomerSyncSource : ICustomerSyncSource
{
    private readonly ICustomerSyncRepository _repository;
    private readonly ILogger<OdsCustomerSyncSource> _logger;

    public OdsCustomerSyncSource(ICustomerSyncRepository repository, ILogger<OdsCustomerSyncSource> logger)
    {
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public string Name => CustomerSyncSources.Ods;

    public async Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions options, CancellationToken cancellationToken)
    {
        var viewRows = await _repository.LoadOdsTradeUnitRowsAsync(cancellationToken);

        var knownIds = appState.Customers.Select(c => c.Id).ToHashSet();
        var mintedByCode = MintedIdsByScoularId(appState.Customers);
        var adoptedRows = 0;
        var adoptedIds = new HashSet<long>();

        var rows = new List<CustomerSyncSourceRow>(viewRows.Count);
        foreach (var v in viewRows)
        {
            var customerId = v.CustomerId;
            if (!knownIds.Contains(customerId) && mintedByCode.TryGetValue(v.ScoularId?.Trim() ?? "", out var minted))
            {
                customerId = minted;
                adoptedRows++;
                adoptedIds.Add(minted);
            }

            rows.Add(new CustomerSyncSourceRow { CustomerId = customerId, TradeUnit = v.TradeUnit, Attributes = new OdsCustomerSyncAttributes(v) });
        }

        if (adoptedRows > 0)
        {
            _logger.LogInformation(
                "CustomerSync ODS feeder adopted {Customers} CTRM-minted customers by ScoularId ({Rows} view rows re-keyed to the minted id instead of inserting a second customer)",
                adoptedIds.Count, adoptedRows);
        }

        var rowIds = rows.Select(r => r.CustomerId).ToHashSet();

        var manualOutsideView = appState.Customers
            .Where(c => c.IsManual && !rowIds.Contains(c.Id))
            .ToList();

        // The master is keyed by ODS id: a minted id cannot be looked up there.
        var unverifiable = manualOutsideView
            .Where(c => CustomerIdMinting.IsMinted(c.Id))
            .Select(c => c.Id)
            .ToHashSet();
        var toLookUp = manualOutsideView
            .Where(c => !unverifiable.Contains(c.Id))
            .ToList();

        var manualMaster = new Dictionary<long, CustomerSyncAttributes>();
        if (toLookUp.Count > 0)
        {
            var masterRows = await _repository.LoadCurrentCustomerMasterAsync(
                toLookUp.Select(c => c.Id).ToList(), cancellationToken);
            // ToDictionary, as the service always did: a duplicate id from the master throws rather than picking one.
            manualMaster = masterRows.ToDictionary(r => r.CustomerId, r => (CustomerSyncAttributes)new OdsCustomerSyncAttributes(r));
        }

        return new CustomerSyncSourceResult { Source = Name, Rows = rows, ManualMaster = manualMaster, ManualUnverifiable = unverifiable };
    }

    /// <summary>Minted app rows by trimmed <c>ScoularId</c> (case-insensitive): active first, then lowest id.</summary>
    private static Dictionary<string, long> MintedIdsByScoularId(IEnumerable<Customer> customers) =>
        customers
            .Where(c => CustomerIdMinting.IsMinted(c.Id) && !string.IsNullOrWhiteSpace(c.ScoularId))
            .GroupBy(c => c.ScoularId!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(c => c.IsActive).ThenBy(c => c.Id).First().Id,
                StringComparer.OrdinalIgnoreCase);
}
