// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class CustomersController : ControllerBase
{
    private readonly ICustomerService _service;

    public CustomersController(ICustomerService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all customers, optionally filtered by trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<CustomerResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CustomerResponse>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Searches customers by name (max 15 results).</summary>
    [HttpGet("search")]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<CustomerResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CustomerResponse>>> Search([FromQuery] string searchTerm, [FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return Ok(await _service.GetAllAsync(tradeUnits, cancellationToken));
        }
        return Ok(await _service.SearchAsync(searchTerm, tradeUnits, cancellationToken));
    }

    /// <summary>
    /// Searches the ODS customer master for producers not yet onboarded into the app
    /// (no contract/ticket, so they never synced into dbo.Customer). Used as a home-page
    /// search fallback so a user can find and onboard them by assigning trade units.
    /// No trade-unit scoping — these producers have no TU yet, which is the whole point.
    /// </summary>
    /// <summary>Minimum onboarding-search term length, enforced server-side. A 1–2 char term is a
    /// broad LIKE scan over the whole producer master and never a useful onboarding lookup; requiring
    /// 3 chars caps how much master-data PII a single query can surface (the client already enforces
    /// this, but the guard must live at the boundary — see AR-04).</summary>
    private const int MinOdsSearchLength = 3;

    [HttpGet("search-ods")]
    [ProducesResponseType(typeof(List<CustomerResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CustomerResponse>>> SearchOds([FromQuery] string searchTerm, CancellationToken cancellationToken = default)
    {
        // Require a specific-enough term at the boundary, not just in the UI, so a direct API call
        // with a 1-char term can't harvest broad producer-master PII a page at a time.
        if (string.IsNullOrWhiteSpace(searchTerm) || searchTerm.Trim().Length < MinOdsSearchLength)
            return Ok(new List<CustomerResponse>());
        // Unscoped by design — these producers have no trade unit yet (the point of onboarding).
        // Returns producer-master contact PII to authenticated reps; accepted risk, see
        // SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-04).
        return Ok(await _service.SearchOdsAsync(searchTerm, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single customer by ID.</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(CustomerResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CustomerResponse>> GetById(long id, CancellationToken cancellationToken = default)
    {
        // No per-producer object-level authz is intentional (trade units are a UX filter, not an
        // access boundary); see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        //
        // ⚠ THE CROSS-TRADE-UNIT CALLER IS REAL — check it before "fixing" this route.
        // handleSelectLinkedCustomer in home.component.ts has an explicit else-branch for a
        // linked producer who is NOT in the caller's roster ("Linked customer is in a different
        // trade unit — fetch them from the API") and calls exactly this endpoint. The stored-
        // trade-unit re-authorization H-073 (2026-09-21) suggests would 403 that path and break
        // the linked-producer profile. Same for GetBySourceId and GetLinkedTo below, which
        // _fetchMissingLinkedProducers uses to pull in producers outside the roster.
        //
        // The test that separates these from routes that HAVE been scoped (H-061, H-062) is
        // whether a real client path needs the cross-trade-unit read. These three do.
        var customer = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Customer", id);
        return Ok(customer);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single customer by their source system ID (e.g. CTRM customer code).</summary>
    [HttpGet("by-source/{sourceId}")]
    [ProducesResponseType(typeof(CustomerResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CustomerResponse>> GetBySourceId(string sourceId, CancellationToken cancellationToken = default)
    {
        // No per-producer object-level authz is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        var customer = await _service.GetByScoularIdAsync(sourceId, cancellationToken)
            ?? throw new NotFoundException("Customer", sourceId);
        return Ok(customer);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets customers whose ProducerDetails.LinkedProducerIds contains the given source id —
    /// i.e. customers that link TO this one (incoming / reverse links). Used by the cross-customer
    /// search path so the customer profile can show bidirectional linked producers even when no TU
    /// is selected.</summary>
    [HttpGet("linked-to/{sourceId}")]
    [ProducesResponseType(typeof(List<CustomerResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CustomerResponse>>> GetLinkedTo(string sourceId, CancellationToken cancellationToken = default)
    {
        // No per-producer object-level authz is intentional — linked producers deliberately span
        // trade units; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetLinkedToAsync(sourceId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a producer's active trade-unit memberships (code + IsManual flag) so the
    /// edit dialog can show which trade units they're on and which are editable vs locked.</summary>
    /// <param name="includeActivity">False skips the open-activity check - a full contract and
    /// unapplied-ticket read for the producer - and leaves every HasOpenActivity at true. For callers
    /// that only need the codes, such as the planting-intention trade-unit picker.</param>
    [HttpGet("{id:long}/trade-units")]
    [ProducesResponseType(typeof(List<CustomerTradeUnitInfo>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CustomerTradeUnitInfo>>> GetTradeUnits(long id, [FromQuery] bool includeActivity = true, CancellationToken cancellationToken = default)
    {
        // No per-producer object-level authz is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        //
        // NOTE: unlike GetById / GetBySourceId / GetLinkedTo above, this route is NOT part of the
        // linked-producer flow — it feeds the edit dialog's membership list. It rests on AR-02's
        // general position instead. H-073 (2026-09-21) argued it also hands an attacker the trade-
        // unit codes to aim at AssignTradeUnits (AR-03); that chaining is real but adds nothing,
        // since AR-03 already accepts that any rep may assign trade units and every rep can read
        // the codes from their own picker.
        return Ok(includeActivity
            ? await _service.GetTradeUnitsAsync(id, cancellationToken)
            : await _service.GetTradeUnitMembershipsAsync(id, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Reconciles a producer's manual trade-unit assignments to the posted set. Onboards them
    /// from the ODS into dbo.Customer if they aren't there yet (manual add, protected from the
    /// nightly sync). Manual TUs not in the set are soft-deactivated; sync-sourced TUs are never
    /// touched. Used to surface producers who exist in CTRM but have no contract/ticket.
    /// </summary>
    [HttpPut("{id:long}/trade-units")]
    [ProducesResponseType(typeof(CustomerResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CustomerResponse>> AssignTradeUnits(long id, [FromBody] AssignTradeUnitsRequest request, CancellationToken cancellationToken = default)
    {
        // Rep-driven onboarding: assigning trade-unit membership is intentionally open to any rep and
        // not admin-gated / caller-entitlement-validated. Accepted risk — see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-03).
        var codes = request.TradeUnitCodes ?? new List<string>();
        var result = await _service.AssignTradeUnitsAsync(id, codes, cancellationToken);

        switch (result)
        {
            case AssignTradeUnitsResult.NoCodes:
                return BadRequest(new { message = "At least one trade unit code is required." });
            case AssignTradeUnitsResult.CustomerNotFound:
                throw new NotFoundException("Customer", id);
            default:
                var customer = await _service.GetByIdAsync(id, cancellationToken);
                return Ok(customer);
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Removes a producer from a SYNC-SOURCED (locked) trade unit they are dormant in — i.e. they
    /// have no open purchase contract and no unapplied ticket in that TU. Re-validates dormancy
    /// server-side (returns 409 if the producer is actually still active there, guarding a stale
    /// dialog), then soft-deactivates the membership and sets UserDeactivated so the nightly sync
    /// respects the removal until activity returns. Manual TU removal still goes through PUT
    /// .../trade-units; this endpoint is only for locked-but-dormant memberships.
    /// </summary>
    [HttpDelete("{id:long}/trade-units/{tradeUnit}")]
    [ProducesResponseType(typeof(List<CustomerTradeUnitInfo>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<List<CustomerTradeUnitInfo>>> RemoveDormantTradeUnit(long id, string tradeUnit, CancellationToken cancellationToken = default)
    {
        // Not admin-gated / caller-entitlement-validated by design. Accepted risk — see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-03).
        var result = await _service.DeactivateDormantTradeUnitAsync(id, tradeUnit, cancellationToken);

        switch (result)
        {
            case DeactivateTradeUnitResult.NotFound:
                throw new NotFoundException("CustomerTradeUnit", $"{id}:{tradeUnit}");
            case DeactivateTradeUnitResult.StillActive:
                return Conflict(new { message = "This producer still has an open contract or unapplied ticket in that trade unit, so it can't be removed." });
            default:
                // Return the refreshed membership list so the dialog can re-render immediately.
                return Ok(await _service.GetTradeUnitsAsync(id, cancellationToken));
        }
    }
}
