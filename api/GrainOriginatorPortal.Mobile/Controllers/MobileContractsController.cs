using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Mapping;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Contract cards (card #645): operations <c>getContractCards</c> and <c>getContractDetail</c>. Reads the ODS view.</summary>
[Route(RoutePrefix + "/customers/{customerId:long}/contracts")]
[RequireTradeUnitEntitlement]
public sealed class MobileContractsController : MobileControllerBase
{
    private readonly IContractService _contracts;
    private readonly ICustomerService _customers;

    public MobileContractsController(IContractService contracts, ICustomerService customers)
    {
        _contracts = contracts;
        _customers = customers;
    }

    [HttpGet]
    [ProducesResponseType(typeof(List<ContractCardDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<List<ContractCardDto>>> GetCards(long customerId, [FromQuery] bool includeClosed = false, CancellationToken cancellationToken = default)
    {
        var (customer, contracts) = await LoadAsync(customerId, cancellationToken);

        // One read for every pricing line of the producer (what the desktop loads), so each card can show the
        // desktop's pricing badge (Flat $x / Priced / Partial / Unpriced / Deferred). The read degrades to an
        // empty list; the badge then falls back to the price type alone.
        var linesByContract = string.IsNullOrWhiteSpace(customer.ScoularId)
            ? new Dictionary<string, List<ContractPricingLineResponse>>()
            : (await _contracts.GetPricingLinesByCustomerAsync(customer.ScoularId, cancellationToken))
                .GroupBy(l => l.ContractId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        return Ok(contracts
            .Where(c => includeClosed || c.ClosedDate is null)
            .OrderByDescending(c => c.DeliveryEnd ?? DateTime.MaxValue)
            .ThenBy(c => c.ContractNumber)
            .Select(c => c.ToCard(c.SourceContractId is { } key && linesByContract.TryGetValue(key, out var l) ? l : []))
            .ToList());
    }

    [HttpGet("{contractId:long}")]
    [ProducesResponseType(typeof(ContractDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ContractDetailDto>> GetDetail(long customerId, long contractId, CancellationToken cancellationToken)
    {
        var (customer, contracts) = await LoadAsync(customerId, cancellationToken);
        var contract = contracts.FirstOrDefault(c => c.Id == contractId)
                       ?? throw new NotFoundException("Contract", contractId);

        // The producer-wide read, filtered to this contract — the SAME source the desktop and the cards use.
        // The per-contract read (GetPricingLinesAsync) is still delegated to ODS while the producer-wide one reads
        // CTRM, so using it here left contracts whose lines are only in CTRM with no pricing lines, and could make
        // the expanded lines disagree with the card's badge (found 2026-10-14).
        var lines = string.IsNullOrWhiteSpace(contract.SourceContractId) || string.IsNullOrWhiteSpace(customer.ScoularId)
            ? []
            : (await _contracts.GetPricingLinesByCustomerAsync(customer.ScoularId, cancellationToken))
                .Where(l => string.Equals(l.ContractId, contract.SourceContractId, StringComparison.OrdinalIgnoreCase))
                .ToList();

        return Ok(contract.ToDetail(lines));
    }

    private async Task<(CustomerResponse Customer, List<ContractResponse> Contracts)> LoadAsync(long customerId, CancellationToken cancellationToken)
    {
        var customer = await _customers.GetByIdAsync(customerId, cancellationToken)
                       ?? throw new NotFoundException("Customer", customerId);

        var contracts = await _contracts.GetByCustomerAsync(customerId, customer.ScoularId, cancellationToken);
        return (customer, contracts.Where(c => c.IsActive && !c.IsDeleted).ToList());
    }
}
