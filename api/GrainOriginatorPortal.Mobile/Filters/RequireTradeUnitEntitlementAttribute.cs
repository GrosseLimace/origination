using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Mobile.Filters;

/// <summary>
/// Trade-unit entitlement as a hard boundary for the mobile surface.
/// <para>
/// The desktop filter (<c>EnforceTradeUnitAccessAttribute</c>) silently narrows GET requests to the
/// caller's trade units because, on the desktop, entitlement is a UX filter (SECURITY-MODEL.md,
/// AR-02). On the internet-facing surface it must be an access boundary instead
/// (SEC-ARCH-BURDI-001 §3.5 "re-validate caller permissions before every data operation"):
/// </para>
/// <list type="bullet">
///   <item>a <c>customerId</c> route/argument is checked with <see cref="IUserEntitlementService.ValidateCustomerAccessAsync"/>;
///   a customer outside the caller's trade units is reported as <b>404</b>, not 403, so the endpoint
///   cannot be used to enumerate customers;</item>
///   <item>a <c>tradeUnits</c> list argument is validated in full and rejected (403) if any code is
///   not entitled — never filtered;</item>
///   <item>when the entitlement store is unavailable and uncached the request fails closed with 503.</item>
/// </list>
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false)]
public sealed class RequireTradeUnitEntitlementAttribute : Attribute, IFilterFactory
{
    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider)
    {
        return new RequireTradeUnitEntitlementFilter(
            serviceProvider.GetRequiredService<IUserEntitlementService>(),
            serviceProvider.GetRequiredService<ILogger<RequireTradeUnitEntitlementAttribute>>());
    }

    internal sealed class RequireTradeUnitEntitlementFilter : IAsyncActionFilter
    {
        private readonly IUserEntitlementService _entitlements;
        private readonly ILogger _logger;

        public RequireTradeUnitEntitlementFilter(IUserEntitlementService entitlements, ILogger logger)
        {
            _entitlements = entitlements;
            _logger = logger;
        }

        public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
        {
            var ct = context.HttpContext.RequestAborted;

            if (!_entitlements.EntitlementsAvailable)
            {
                _logger.LogError(
                    "Entitlements unavailable and uncached — refusing mobile request for {Path}. [{ErrorCode}] [{ErrorCategory}]",
                    context.HttpContext.Request.Path, "ENTITLEMENTS_FAIL_CLOSED", "Security");
                throw new InfrastructureException(
                    "Authorization data is temporarily unavailable. Please retry shortly.",
                    "ENTITLEMENTS_DB_UNAVAILABLE",
                    StatusCodes.Status503ServiceUnavailable);
            }

            if (context.ActionArguments.TryGetValue("customerId", out var customerIdObj) && customerIdObj is long customerId)
            {
                try
                {
                    await _entitlements.ValidateCustomerAccessAsync(customerId, ct);
                }
                catch (ForbiddenException)
                {
                    // 404 rather than 403: do not confirm that the customer exists.
                    _logger.LogWarning(
                        "Mobile customer access denied on {Method} {Path} for customer {CustomerId}. [{ErrorCode}] [{ErrorCategory}]",
                        context.HttpContext.Request.Method, context.HttpContext.Request.Path, customerId,
                        "MOBILE_CUSTOMER_NOT_ENTITLED", "Security");
                    throw new NotFoundException("Customer", customerId);
                }
            }

            if (context.ActionArguments.TryGetValue("tradeUnits", out var tradeUnitsObj)
                && tradeUnitsObj is List<string> tradeUnits && tradeUnits.Count > 0)
            {
                // Throws ForbiddenException (403) when any code is outside the caller's entitlement.
                await _entitlements.ValidateTradeUnitsOrThrowAsync(tradeUnits, ct);
            }

            await next();
        }
    }
}
