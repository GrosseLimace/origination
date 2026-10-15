// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;

// Project namespaces
using GrainOriginatorPortal.Mobile;
using GrainOriginatorPortal.Mobile.Authorization;
using GrainOriginatorPortal.Mobile.Controllers;
using GrainOriginatorPortal.Mobile.Filters;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// The mobile surface's guarantees, pinned as tests (SEC-ARCH-BURDI-001 §3.2 / ADR-001). A failure
/// here means a mobile controller escaped the MobileAccess policy, the audit filter, the rate limit,
/// the api/mobile/v1 prefix, or the trade-unit boundary.
/// </summary>
public class MobileSurfaceConventionTests
{
    public static IEnumerable<object[]> MobileControllerTypes() =>
        MobileControllers().Select(t => new object[] { t });

    internal static IReadOnlyList<Type> MobileControllers() =>
        typeof(MobileAssemblyMarker).Assembly.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && typeof(ControllerBase).IsAssignableFrom(t))
            .OrderBy(t => t.Name)
            .ToList();

    [Fact]
    public void MobileAssembly_HasControllers()
    {
        Assert.NotEmpty(MobileControllers());
    }

    [Theory]
    [MemberData(nameof(MobileControllerTypes))]
    public void Controller_DerivesFromMobileControllerBase(Type controllerType)
    {
        Assert.True(typeof(MobileControllerBase).IsAssignableFrom(controllerType),
            $"{controllerType.Name} must derive from MobileControllerBase so it inherits the MobileAccess policy, audit filter and rate limit.");
    }

    [Theory]
    [MemberData(nameof(MobileControllerTypes))]
    public void Controller_RouteStartsWithMobilePrefix(Type controllerType)
    {
        var route = controllerType.GetCustomAttribute<RouteAttribute>(inherit: false);
        Assert.NotNull(route);
        Assert.StartsWith(MobileControllerBase.RoutePrefix, route!.Template, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(MobileControllerTypes))]
    public void Controller_HasNoAllowAnonymous(Type controllerType)
    {
        Assert.Empty(controllerType.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
        foreach (var action in Actions(controllerType))
        {
            Assert.Empty(action.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
        }
    }

    [Theory]
    [MemberData(nameof(MobileControllerTypes))]
    public void Controller_InheritsTheFourGuarantees(Type controllerType)
    {
        var authorize = controllerType.GetCustomAttributes<AuthorizeAttribute>(inherit: true).ToList();
        Assert.Contains(authorize, a => a.Policy == MobileAccess.PolicyName);

        var serviceFilters = controllerType.GetCustomAttributes<ServiceFilterAttribute>(inherit: true).ToList();
        Assert.Contains(serviceFilters, f => f.ServiceType == typeof(MobileAuditActionFilter));

        var rateLimit = controllerType.GetCustomAttribute<EnableRateLimitingAttribute>(inherit: true);
        Assert.NotNull(rateLimit);
        Assert.Equal(MobileAccess.RateLimitPolicyName, rateLimit!.PolicyName);

        Assert.NotNull(controllerType.GetCustomAttribute<RequestSizeLimitAttribute>(inherit: true));
        Assert.NotNull(controllerType.GetCustomAttribute<ApiControllerAttribute>(inherit: true));
    }

    /// <summary>
    /// Any action that takes a customerId must be behind the deny-not-filter entitlement check,
    /// on the action or on its controller. This is the mobile replacement for AR-02.
    /// </summary>
    [Theory]
    [MemberData(nameof(MobileControllerTypes))]
    public void Actions_WithCustomerId_RequireTradeUnitEntitlement(Type controllerType)
    {
        var controllerHasIt = controllerType.GetCustomAttribute<RequireTradeUnitEntitlementAttribute>(inherit: true) is not null;

        var unguarded = Actions(controllerType)
            .Where(m => m.GetParameters().Any(p => p.Name == "customerId"))
            .Where(m => !controllerHasIt && m.GetCustomAttribute<RequireTradeUnitEntitlementAttribute>() is null)
            .Select(m => m.Name)
            .ToList();

        Assert.True(unguarded.Count == 0,
            $"{controllerType.Name}: actions taking customerId without [RequireTradeUnitEntitlement]: {string.Join(", ", unguarded)}");
    }

    /// <summary>Every mobile mutation must be replay-safe: its body carries a ClientRequestId.</summary>
    [Theory]
    [MemberData(nameof(MobileControllerTypes))]
    public void Mutations_CarryClientRequestId(Type controllerType)
    {
        var offenders = Actions(controllerType)
            .Where(IsMutation)
            .Where(m => !m.GetParameters().Any(p => p.ParameterType.GetProperty("ClientRequestId") is not null))
            .Select(m => m.Name)
            .ToList();

        Assert.True(offenders.Count == 0,
            $"{controllerType.Name}: mutations without a ClientRequestId in the request body: {string.Join(", ", offenders)}");
    }

    private static IEnumerable<MethodInfo> Actions(Type controllerType) =>
        controllerType.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName && m.GetCustomAttributes<HttpMethodAttribute>().Any());

    private static bool IsMutation(MethodInfo action) =>
        action.GetCustomAttributes<HttpMethodAttribute>()
            .SelectMany(a => a.HttpMethods)
            .Any(v => v is "POST" or "PUT" or "PATCH" or "DELETE");
}
