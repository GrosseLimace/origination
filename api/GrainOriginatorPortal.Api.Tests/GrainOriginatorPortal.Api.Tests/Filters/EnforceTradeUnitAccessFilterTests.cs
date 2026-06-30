// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Filters;

/// <summary>
/// Regression tests for EnforceTradeUnitAccess on COLLECTION request bodies. The dashboard upsert
/// routes post List&lt;T&gt; (estimates / market shares / actual harvest); the filter must validate the
/// TradeUnitKey on every element, not just reflect a top-level property (which a List&lt;T&gt; lacks).
/// Without this, a caller could persist rows for trade units they aren't entitled to (CWE-639).
/// </summary>
public class EnforceTradeUnitAccessFilterTests
{
    private static IAsyncActionFilter BuildFilter(IUserEntitlementService entitlement)
    {
        var services = new ServiceCollection();
        services.AddSingleton(entitlement);
        services.AddLogging();
        var provider = services.BuildServiceProvider();
        return (IAsyncActionFilter)new EnforceTradeUnitAccessAttribute().CreateInstance(provider);
    }

    private static Mock<IUserEntitlementService> EntitlementAllowing(params string[] allowed)
    {
        var mock = new Mock<IUserEntitlementService>();
        mock.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        mock.Setup(e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlySet<string>)new HashSet<string>(allowed, StringComparer.OrdinalIgnoreCase));
        // Default: allow (real service throws on unauthorized; we add a specific throwing setup per test).
        mock.Setup(e => e.ValidateTradeUnitsOrThrowAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        return mock;
    }

    private static ActionExecutingContext PostContext(string argName, object body)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = "POST";
        var actionContext = new ActionContext(httpContext, new RouteData(), new ActionDescriptor());
        return new ActionExecutingContext(
            actionContext,
            new List<IFilterMetadata>(),
            new Dictionary<string, object?> { [argName] = body },
            controller: new object());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ListBody_WithUnauthorizedTradeUnitKey_ValidatesEachElement_AndRejects()
    {
        var entitlement = EntitlementAllowing("TU1");
        entitlement.Setup(e => e.ValidateTradeUnitsOrThrowAsync(
                It.Is<IEnumerable<string>>(c => c.Contains("TU9")), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ForbiddenException("Not entitled to trade unit 'TU9'."));
        var filter = BuildFilter(entitlement.Object);

        var items = new List<UpsertDashboardActualHarvestRequest>
        {
            new() { TradeUnitKey = "TU1", CropCategory = "Corn", PlantingYear = 2026, Bushels = 100 },
            new() { TradeUnitKey = "TU9", CropCategory = "Corn", PlantingYear = 2026, Bushels = 200 }, // foreign TU
        };
        var ctx = PostContext("items", items);

        var nextCalled = false;
        ActionExecutionDelegate next = () => { nextCalled = true; return Task.FromResult<ActionExecutedContext>(null!); };

        await Assert.ThrowsAsync<ForbiddenException>(() => filter.OnActionExecutionAsync(ctx, next));
        Assert.False(nextCalled); // request must not reach the action
        entitlement.Verify(e => e.ValidateTradeUnitsOrThrowAsync(
            It.Is<IEnumerable<string>>(c => c.Contains("TU9")), It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ListBody_WithAuthorizedTradeUnitKey_PassesThrough()
    {
        var entitlement = EntitlementAllowing("TU1");
        var filter = BuildFilter(entitlement.Object);

        var estimates = new List<UpsertDashboardEstimateRequest>
        {
            new() { TradeUnitKey = "TU1", Crop = "Corn", PlantingYear = 2026, YieldEstimate = 50 },
        };
        var ctx = PostContext("estimates", estimates);

        var nextCalled = false;
        ActionExecutionDelegate next = () => { nextCalled = true; return Task.FromResult<ActionExecutedContext>(null!); };

        await filter.OnActionExecutionAsync(ctx, next);

        Assert.True(nextCalled);
        entitlement.Verify(e => e.ValidateTradeUnitsOrThrowAsync(
            It.Is<IEnumerable<string>>(c => c.Contains("TU1")), It.IsAny<CancellationToken>()), Times.Once);
    }
}
