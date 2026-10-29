// Project namespaces
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class CallingMatchService : ICallingMatchService
{
    private readonly ICustomerRepository _customers;
    private readonly ILogger<CallingMatchService> _logger;

    public CallingMatchService(ICustomerRepository customers, ILogger<CallingMatchService> logger)
    {
        _customers = customers;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<IncomingCallMatchResponse>> MatchAsync(string? callerNumber, CancellationToken cancellationToken)
    {
        var digits = PhoneDigits.Normalize(callerNumber);
        if (digits is null)
            return []; // Withheld / short / garbage caller id: nothing to look up.

        var matches = await _customers.FindByPhoneAsync(digits, cancellationToken);

        // Count only. The number is a producer's phone (PII) and must not reach the logs.
        _logger.LogInformation("Incoming-call lookup matched {Count} producers", matches.Count);

        return matches.Select(m => new IncomingCallMatchResponse
        {
            CustomerId = m.Customer.Id,
            Name = m.Customer.Name,
            ContactName = m.ContactNames.FirstOrDefault(),
            ContactNames = m.ContactNames,
            ScoularId = m.Customer.ScoularId,
            Location = m.Customer.Location,
            StateProvince = m.Customer.StateProvince,
            TradeUnit = m.Customer.ActiveTradeUnits.FirstOrDefault(),
            TradeUnits = m.Customer.ActiveTradeUnits,
        }).ToList();
    }
}
