// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Filters;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

public class RequireTradeUnitEntitlementFilterTests
{
    private readonly Mock<IUserEntitlementService> _entitlements = new();
    private bool _nextCalled;

    private RequireTradeUnitEntitlementAttribute.RequireTradeUnitEntitlementFilter Sut()
        => new(_entitlements.Object, Mock.Of<ILogger>());

    private ActionExecutingContext Context(string method, params (string Name, object? Value)[] args)
    {
        var http = new DefaultHttpContext();
        http.Request.Method = method;
        http.Request.Path = "/api/mobile/v1/customers/42";
        var actionContext = new ActionContext(http, new RouteData(), new ActionDescriptor());
        var arguments = args.ToDictionary(a => a.Name, a => a.Value);
        return new ActionExecutingContext(actionContext, [], arguments, controller: new object());
    }

    private Task<ActionExecutedContext> Next()
    {
        _nextCalled = true;
        return Task.FromResult<ActionExecutedContext>(null!);
    }

    [Fact]
    public async Task CustomerOutsideEntitlement_Becomes404_NotFound()
    {
        _entitlements.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        _entitlements.Setup(e => e.ValidateCustomerAccessAsync(42L, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ForbiddenException("denied"));

        var ex = await Assert.ThrowsAsync<NotFoundException>(() =>
            Sut().OnActionExecutionAsync(Context("GET", ("customerId", 42L)), Next));

        Assert.Contains("42", ex.Message);
        Assert.False(_nextCalled);
    }

    [Fact]
    public async Task EntitledCustomer_ProceedsToTheAction()
    {
        _entitlements.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        _entitlements.Setup(e => e.ValidateCustomerAccessAsync(42L, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        await Sut().OnActionExecutionAsync(Context("GET", ("customerId", 42L)), Next);

        Assert.True(_nextCalled);
    }

    [Fact]
    public async Task EntitlementsUnavailable_FailsClosedWith503_EvenForReads()
    {
        _entitlements.SetupGet(e => e.EntitlementsAvailable).Returns(false);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(() =>
            Sut().OnActionExecutionAsync(Context("GET", ("customerId", 42L)), Next));

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, ex.HttpStatusCode);
        Assert.False(_nextCalled);
        _entitlements.Verify(e => e.ValidateCustomerAccessAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task TradeUnits_AreValidatedNotFiltered_OnReads()
    {
        _entitlements.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        var requested = new List<string> { "1001", "9999" };
        _entitlements.Setup(e => e.ValidateTradeUnitsOrThrowAsync(requested, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ForbiddenException("9999 not entitled"));

        var context = Context("GET", ("tradeUnits", requested));

        await Assert.ThrowsAsync<ForbiddenException>(() => Sut().OnActionExecutionAsync(context, Next));

        // The desktop filter would have silently narrowed the list; the mobile filter must not touch it.
        Assert.Same(requested, context.ActionArguments["tradeUnits"]);
        Assert.False(_nextCalled);
    }

    [Fact]
    public async Task NoRecognisedArguments_ProceedsWithoutCallingEntitlements()
    {
        _entitlements.SetupGet(e => e.EntitlementsAvailable).Returns(true);

        await Sut().OnActionExecutionAsync(Context("GET"), Next);

        Assert.True(_nextCalled);
        _entitlements.Verify(e => e.ValidateCustomerAccessAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
        _entitlements.Verify(e => e.ValidateTradeUnitsOrThrowAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
