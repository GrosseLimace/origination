using GrainOriginatorPortal.Api.Exceptions;
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

            // If the TradeUnitPreferences DB was unreachable AND there was no last-known-good cache to fall
            // back on (UserEntitlementService), fail CLOSED rather than serving unfiltered data:
            // skipping the filter here would let every user see all trade units' data during the
            // outage (CWE-285). Return 503 so the client retries instead. Writes already fail closed
            // via ValidateTradeUnitsOrThrowAsync below.
            if (!_entitlementService.EntitlementsAvailable && isReadRequest)
            {
                _logger.LogError(
                    "Entitlements unavailable and uncached — refusing unfiltered read for {Path}. [{ErrorCode}]",
                    context.HttpContext.Request.Path, "ENTITLEMENTS_FAIL_CLOSED");
                throw new InfrastructureException(
                    "Authorization data is temporarily unavailable. Please retry shortly.",
                    "ENTITLEMENTS_DB_UNAVAILABLE",
                    StatusCodes.Status503ServiceUnavailable);
            }

            // Tracks whether any of the three patterns below actually recognised this action's
            // parameters. Without it the filter fell through to next() with zero enforcement and
            // zero trace whenever a signature drifted out of the shapes it knows — which already
            // caused one live gap (H-061, DELETE actualharvest/{id}). Now it says so out loud.
            var enforced = false;

            // Pattern 1: tradeUnits as List<string> (Customers, Contracts, Tickets)
            if (context.ActionArguments.TryGetValue("tradeUnits", out var tradeUnitsObj) && tradeUnitsObj is List<string> tradeUnitsList && tradeUnitsList.Count > 0)
            {
                enforced = true;
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
                enforced = true;
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

            // Pattern 3: [FromBody] request object(s) carrying a TradeUnitKey — either a single DTO OR a
            // COLLECTION of DTOs. The dashboard upserts post List<T> (estimates / market shares / actual
            // harvest), so the key must be validated on EACH element. Reflecting only the top-level arg's
            // TradeUnitKey would miss list bodies entirely (a List<T> has no such property), letting a
            // caller persist rows for trade units they aren't entitled to (CWE-639).
            foreach (var arg in context.ActionArguments.Values)
            {
                if (arg is null) continue;
                var bodyCodes = ExtractTradeUnitKeys(arg);
                if (bodyCodes.Count > 0)
                {
                    enforced = true;
                    await _entitlementService.ValidateTradeUnitsOrThrowAsync(bodyCodes, context.HttpContext.RequestAborted);
                }
            }

            if (!enforced)
            {
                // Deliberately a loud log rather than a hard failure: several decorated actions
                // legitimately carry no trade-unit parameter (the id-only routes scope in the
                // service layer instead), so throwing here would break working endpoints. This
                // makes the silent case searchable so drift is caught before it becomes a gap.
                _logger.LogWarning(
                    "EnforceTradeUnitAccess matched no known parameter shape on {Method} {Path} — no filtering applied by this attribute. [{ErrorCode}] [{ErrorCategory}]",
                    context.HttpContext.Request.Method,
                    context.HttpContext.Request.Path,
                    "ENTITLEMENTS_FILTER_NOT_APPLIED",
                    "Security");
            }

            await next();
        }

        /// <summary>Collects the (comma-split) TradeUnitKey values carried by a [FromBody] argument —
        /// from a single DTO or from every element of a collection body. Returns empty for strings
        /// (handled by the tradeUnits / tradeUnitKey patterns above) and for objects without the property.</summary>
        private static List<string> ExtractTradeUnitKeys(object arg)
        {
            var codes = new List<string>();
            void AddFrom(object? item)
            {
                if (item is null) return;
                if (item.GetType().GetProperty("TradeUnitKey")?.GetValue(item) is string key && !string.IsNullOrWhiteSpace(key))
                {
                    codes.AddRange(key.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                }
            }

            if (arg is string) return codes;                       // a tradeUnitKey string is handled above
            if (arg is System.Collections.IEnumerable seq)
            {
                foreach (var item in seq) AddFrom(item);
            }
            else
            {
                AddFrom(arg);
            }
            return codes;
        }
    }
}
