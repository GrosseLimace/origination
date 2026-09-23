using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class UserTradeUnitService : IUserTradeUnitService
{
    private readonly IEntitlementsRepository _entitlements;
    private readonly IMbpLocationSynonymRepository _locations;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<UserTradeUnitService> _logger;

    public UserTradeUnitService(
        IEntitlementsRepository entitlements,
        IMbpLocationSynonymRepository locations,
        IRequestContextService requestContext,
        ILogger<UserTradeUnitService> logger)
    {
        _entitlements = entitlements;
        _locations = locations;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<UserTradeUnitGroupResponse>> GetForCurrentUserAsync(CancellationToken cancellationToken)
    {
        var userId = _requestContext.GetCurrentUserShortName();
        if (string.IsNullOrWhiteSpace(userId))
            return [];

        try
        {
            var rows = await _entitlements.GetByUserAsync(userId, cancellationToken);

            // The location shown next to each trade unit is resolved with a two-source fallback:
            //   1. dbo.MbpLocationSynonym (the MBPLOCSYN master): the trade unit code IS a bare LocationId
            //      (e.g. "2115" -> "2115"; NOT the composite "2115-ADRIAN") -> its curated DisplayName
            //      ("Adrian, MO"). Preferred source.
            //   2. If that table has no DisplayName for the code, fall back to the entitlements-view
            //      Description (the source used before MbpLocationSynonym).
            //   3. If both are missing, show nothing (just the code).
            var grouped = rows
                .Select(u => new { GroupName = u.GroupName ?? "Default", u.TradeUnitCode, u.Description })
                .GroupBy(u => u.GroupName)
                .OrderBy(g => g.Key)
                .ToList();

            var allCodes = grouped
                .SelectMany(g => g.Select(u => u.TradeUnitCode))
                .Where(c => !string.IsNullOrWhiteSpace(c))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var displayNames = await _locations.GetDisplayNamesByLocationIdsAsync(allCodes, cancellationToken);

            return grouped
                .Select(g =>
                {
                    // Dedupe by code within the group; location = MbpLocationSynonym DisplayName, else the
                    // entitlements Description, else blank.
                    var units = g
                        .GroupBy(u => u.TradeUnitCode)
                        .Select(cg =>
                        {
                            var mbpDisplayName = displayNames.GetValueOrDefault(cg.Key.Trim());
                            var entitlementsDescription = cg
                                .Select(x => x.Description)
                                .FirstOrDefault(d => !string.IsNullOrWhiteSpace(d));
                            return new TradeUnitOptionResponse
                            {
                                Code = cg.Key,
                                Description = !string.IsNullOrWhiteSpace(mbpDisplayName)
                                    ? mbpDisplayName
                                    : entitlementsDescription
                            };
                        })
                        .OrderBy(o => o.Code)
                        .ToList();
                    return new UserTradeUnitGroupResponse
                    {
                        GroupName = g.Key,
                        TradeUnitCodes = units.Select(u => u.Code).ToList(),
                        TradeUnits = units
                    };
                })
                .ToList();
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            // Fail closed on a TradeUnitPreferences DB outage: surface a 503 rather than falling open to
            // ALL trade unit codes (CWE-285). Previously this fell back to every active code from
            // dbo.CustomerTradeUnit, which leaked the full org trade-unit structure to any user during a
            // transient outage. It then returned an empty 200 — but an empty 200 now has a real meaning
            // ("this user has no assignments": the client clears their saved selection and points them at
            // Trade Unit Preferences), so an outage must be distinguishable: 503 lands in the client's
            // error path ("Trade units unavailable · Retry") and leaves their saved selection alone.
            _logger.LogError(ex,
                "TradeUnitPreferences DB unavailable for user {UserId} — failing closed (503). [{ErrorCode}]",
                userId, "ENTITLEMENTS_DB_UNAVAILABLE");
            throw new InfrastructureException(
                "Trade unit assignments are temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE",
                ex,
                StatusCodes.Status503ServiceUnavailable);
        }
    }
}
