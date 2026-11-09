// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Extensions;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Interfaces;

namespace GrainOriginatorPortal.Infrastructure.Modules.Contracts;

/// <summary>
/// The trade units in which a producer still has open activity: an open purchase contract, or an
/// unapplied ticket (U/L/C) within the last three years that survives the storage gate. Contracts answers
/// this for the Customers module, which locks those trade-unit memberships.
/// </summary>
/// <remarks>
/// <para>Decides which trade-unit memberships are LOCKED - the edit dialog will not let a user remove
/// one with open activity, and the nightly sync brings a user-deactivated one back if activity
/// reappears. So this has to agree with what the producer screen shows.</para>
///
/// <para>It therefore reads through the same switch-backed repositories the producer screen uses,
/// rather than querying the ODS views directly as it once did. With <c>Ctrm:Source</c> set to
/// <c>ctrm</c> that is CTRM; otherwise ODS - and either way it is the SAME rows the screen renders.
/// The previous inline ODS query could disagree with a CTRM-backed screen: a contract CTRM shows as
/// open would not lock its trade unit here, and the user could remove a membership the screen said
/// was active.</para>
///
/// <para>Rules preserved exactly: contracts contribute their trade unit only while OPEN (the
/// repositories already normalise the Db2 min-date sentinel to null); tickets contribute their
/// organization code only when unapplied, and both repositories already apply the ticket-type,
/// consolidated, three-year and storage-gate rules to that set.</para>
/// </remarks>
public sealed class CustomerActivitySource(IContractRepository contracts, ITicketRepository tickets) : ICustomerActivitySource
{
    public async Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken)
    {
        var openTus = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var code = scoularId?.Trim();
        if (string.IsNullOrEmpty(code)) return openTus;

        // customerId is not needed when the code is supplied; both repositories use the code directly.
        //
        // SEQUENTIAL, deliberately. With Ctrm:Source = ods both repositories are the ODS ones, and
        // they share this scope's single OriginationDbContext. Running the two reads concurrently
        // (Task.WhenAll) made EF throw "a second operation was started on this context instance"
        // the moment the second query began. That took down the PROD customer sync on 2026-09-29
        // (bring-back pass, first run on the new build) and the trade-unit assign / remove actions
        // with it; QA never saw it because its CTRM repositories go over HTTP, which is thread-safe.
        // One read after the other costs a few hundred milliseconds per producer and is correct on
        // both sources.
        var openContracts = await contracts.GetByCustomerAsync(0, code, cancellationToken);
        var unappliedTickets = await tickets.GetUnappliedByCustomerAsync(0, code, cancellationToken);

        foreach (var c in openContracts)
            if (c.ClosedDate is null && !string.IsNullOrWhiteSpace(c.TradeUnit))
                openTus.Add(c.TradeUnit.Trim());

        foreach (var t in unappliedTickets)
            if (!string.IsNullOrWhiteSpace(t.OrganizationCode))
                openTus.Add(t.OrganizationCode.Trim());

        return openTus;
    }
}
