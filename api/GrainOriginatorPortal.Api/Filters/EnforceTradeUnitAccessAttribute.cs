using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc.Filters;

namespace GrainOriginatorPortal.Api.Filters;

/// <summary>
/// Action filter that enforces trade unit access against the authenticated user's entitlements.
/// For GET requests: silently filters the trade unit parameters down to only the allowed ones.
/// For mutation requests (POST/PUT/DELETE): rejects if any unauthorized trade units are present.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false)]
public class EnforceTradeUnitAccessAttribute : Attribute, IFilterFactory
{
    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider)
    {
        var entitlementService = serviceProvider.GetRequiredService<IUserEntitlementService>();
        var logger = serviceProvider.GetRequiredService<ILogger<EnforceTradeUnitAccessAttribute>>();
        return new EnforceTradeUnitAccessFilter(entitlementService, logger);
    }

    private sealed class EnforceTradeUnitAccessFilter : IAsyncActionFilter
    {
        private readonly IUserEntitlementService _entitlementService;
        private readonly ILogger _logger;

        public EnforceTradeUnitAccessFilter(IUserEntitlementService entitlementService, ILogger logger)
        {
            _entitlementService = entitlementService;
            _logger = logger;
        }

        public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
        {
            var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(context.HttpContext.RequestAborted);
            var isReadRequest = HttpMethods.IsGet(context.HttpContext.Request.Method)
                             || HttpMethods.IsHead(context.HttpContext.Request.Method);

            // If the Entitlements DB was unreachable, skip filtering on read requests rather
            // than stripping all trade units and causing 400/empty responses.
            if (!_entitlementService.EntitlementsAvailable && isReadRequest)
            {
                await next();
                return;
            }

            // Pattern 1: tradeUnits as List<string> (Customers, Contracts, Tickets)
            if (context.ActionArguments.TryGetValue("tradeUnits", out var tradeUnitsObj) && tradeUnitsObj is List<string> tradeUnitsList && tradeUnitsList.Count > 0)
            {
                if (isReadRequest)
                {
                    var filtered = tradeUnitsList.Where(c => !string.IsNullOrWhiteSpace(c) && allowed.Contains(c)).ToList();
                    if (filtered.Count < tradeUnitsList.Count)
                    {
                        _logger.LogInformation("Filtered trade units from {Original} to {Filtered} for GET request", tradeUnitsList.Count, filtered.Count);
                    }
                    context.ActionArguments["tradeUnits"] = filtered;
                }
                else
                {
                    await _entitlementService.ValidateTradeUnitsOrThrowAsync(tradeUnitsList, context.HttpContext.RequestAborted);
                }
            }

            // Pattern 2: tradeUnitKey as comma-separated string (Dashboard GET endpoints)
            if (context.ActionArguments.TryGetValue("tradeUnitKey", out var tradeUnitKeyObj) && tradeUnitKeyObj is string tradeUnitKey && !string.IsNullOrWhiteSpace(tradeUnitKey))
            {
                var codes = tradeUnitKey.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (isReadRequest)
                {
                    var filtered = codes.Where(c => allowed.Contains(c)).ToArray();
                    if (filtered.Length < codes.Length)
                    {
                        _logger.LogInformation("Filtered tradeUnitKey from {Original} to {Filtered} for GET request", codes.Length, filtered.Length);
                    }
                    context.ActionArguments["tradeUnitKey"] = string.Join(",", filtered);
                }
                else
                {
                    await _entitlementService.ValidateTradeUnitsOrThrowAsync(codes, context.HttpContext.RequestAborted);
                }
            }

            // Pattern 3: [FromBody] request objects with TradeUnitKey property (Dashboard POST/PUT)
            foreach (var arg in context.ActionArguments.Values)
            {
                if (arg is null) continue;

                var prop = arg.GetType().GetProperty("TradeUnitKey");
                if (prop?.GetValue(arg) is string bodyKey && !string.IsNullOrWhiteSpace(bodyKey))
                {
                    var codes = bodyKey.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    await _entitlementService.ValidateTradeUnitsOrThrowAsync(codes, context.HttpContext.RequestAborted);
                }
            }

            await next();
        }
    }
}
