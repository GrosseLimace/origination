// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Filters;

/// <summary>
/// The one thing standing between a CTRM outage and a grower's deliveries reading as zero.
/// </summary>
/// <remarks>
/// The repositories return an empty list when a read fails, by design. Without this filter that empty
/// list reaches the browser and renders as "no producers found" - which happened twice during development
/// before anyone realised the gateway had timed out.
/// </remarks>
public class SurfaceCtrmFailuresAttributeTests
{
    private static (ActionExecutingContext Context, CtrmProvenance Provenance) Ctx()
    {
        var provenance = new CtrmProvenance();
        var services = new ServiceCollection();
        services.AddSingleton(provenance);

        var http = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        var actionContext = new ActionContext(http, new RouteData(), new ActionDescriptor());

        return (new ActionExecutingContext(actionContext, [], new Dictionary<string, object?>(), controller: null!), provenance);
    }

    private static ActionExecutionDelegate Next(ActionExecutingContext context, Exception? thrown = null) => () =>
    {
        var executed = new ActionExecutedContext(context, [], controller: null!);
        if (thrown is not null) executed.Exception = thrown;
        return Task.FromResult(executed);
    };

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(CtrmReadStatus.EgressBlocked)]
    [InlineData(CtrmReadStatus.TokenFailure)]
    [InlineData(CtrmReadStatus.Unauthorized)]
    [InlineData(CtrmReadStatus.Throttled)]
    [InlineData(CtrmReadStatus.QueryError)]
    [InlineData(CtrmReadStatus.Error)]
    [InlineData(CtrmReadStatus.Warming)]
    public async Task AFailedReadBecomesA503(CtrmReadStatus status)
    {
        var (context, provenance) = Ctx();
        provenance.RecordFailure("contracts", status, "stub detail");

        var thrown = await Assert.ThrowsAsync<InfrastructureException>(
            () => new SurfaceCtrmFailuresAttribute().OnActionExecutionAsync(context, Next(context)));

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, thrown.HttpStatusCode);
        Assert.Equal("INFRASTRUCTURE_CTRM_UNAVAILABLE", thrown.ErrorCode);
        Assert.Contains("Contracts", thrown.Message);
        Assert.Contains(status.ToString(), thrown.Message);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheMessageNamesWhichReadFailed()
    {
        var (context, provenance) = Ctx();
        provenance.RecordFailure("tickets", CtrmReadStatus.EgressBlocked, null);

        var thrown = await Assert.ThrowsAsync<InfrastructureException>(
            () => new SurfaceCtrmFailuresAttribute().OnActionExecutionAsync(context, Next(context)));

        Assert.Contains("Tickets", thrown.Message);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheMessageCarriesNoProducerOrQueryDetail()
    {
        // The detail from CTRM can name a producer code or echo a query; the response is for a browser.
        var (context, provenance) = Ctx();
        provenance.RecordFailure("tickets", CtrmReadStatus.QueryError, "failed for producer TATOBIN: customerIds [...]");

        var thrown = await Assert.ThrowsAsync<InfrastructureException>(
            () => new SurfaceCtrmFailuresAttribute().OnActionExecutionAsync(context, Next(context)));

        Assert.DoesNotContain("TATOBIN", thrown.Message);
        Assert.DoesNotContain("customerIds", thrown.Message);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AGenuinelyEmptyResultIsStillASuccess()
    {
        // A producer with no contracts must keep rendering as an empty list, not an error.
        var (context, provenance) = Ctx();
        provenance.RecordContracts("ctrm", "Ok", 0);

        await new SurfaceCtrmFailuresAttribute().OnActionExecutionAsync(context, Next(context));

        Assert.False(context.HttpContext.Response.Headers.ContainsKey(SurfaceCtrmFailuresAttribute.PartialHeader));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ATruncatedReadStays200ButSaysSo()
    {
        // Truncated rows are real rows; more useful shown than withheld, provided the client can warn.
        var (context, provenance) = Ctx();
        provenance.RecordContracts("ctrm", "OkTruncated", 500);
        provenance.RecordPartial();

        await new SurfaceCtrmFailuresAttribute().OnActionExecutionAsync(context, Next(context));

        Assert.Equal("true", context.HttpContext.Response.Headers[SurfaceCtrmFailuresAttribute.PartialHeader]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnActionThatAlreadyThrewKeepsItsOwnError()
    {
        var (context, provenance) = Ctx();
        provenance.RecordFailure("contracts", CtrmReadStatus.EgressBlocked, null);

        // Must surface the action's exception, not replace it with the CTRM one.
        await new SurfaceCtrmFailuresAttribute()
            .OnActionExecutionAsync(context, Next(context, new InvalidOperationException("the real cause")));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheFirstFailureIsTheOneReported()
    {
        // A contract failure usually causes the ticket read to come back empty too; the first is the cause.
        var (context, provenance) = Ctx();
        provenance.RecordFailure("contracts", CtrmReadStatus.EgressBlocked, null);
        provenance.RecordFailure("tickets", CtrmReadStatus.Error, null);

        var thrown = await Assert.ThrowsAsync<InfrastructureException>(
            () => new SurfaceCtrmFailuresAttribute().OnActionExecutionAsync(context, Next(context)));

        Assert.Contains("Contracts", thrown.Message);
        Assert.Contains("EgressBlocked", thrown.Message);
    }
}
