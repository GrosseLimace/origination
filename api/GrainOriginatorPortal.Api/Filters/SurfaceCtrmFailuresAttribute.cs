using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using Microsoft.AspNetCore.Mvc.Filters;

namespace GrainOriginatorPortal.Api.Filters;

/// <summary>
/// Turns a failed CTRM read into an explicit error response instead of letting it look like no data.
/// </summary>
/// <remarks>
/// <para><b>The problem.</b> The CTRM repositories return an empty list when a read fails and never fall
/// back to ODS - deliberately, because silently serving ODS data on a screen labelled CTRM would hide the
/// failure and invalidate any comparison drawn from it. But an empty list is indistinguishable from "this
/// producer genuinely has no contracts". During development a gateway timeout rendered as
/// "no producers found" twice before anyone realised CTRM was down. At harvest, a grower's deliveries
/// showing as zero because of a timeout is the worst failure this integration can have.</para>
///
/// <para><b>Why a filter rather than throwing in the repository.</b> Throwing from the repository would
/// also break internal callers that legitimately tolerate an empty result - the open-activity trade-unit
/// lock, for instance, asks for a producer's contracts to decide whether a trade unit can be removed, and
/// should not take a whole screen down when CTRM is briefly unavailable. Confining the conversion to the
/// endpoints that feed a user-visible list keeps that distinction, and needs no change to the repository
/// interfaces the ODS implementations also satisfy.</para>
///
/// <para><b>Partial results stay 200.</b> A truncated read has real rows in it and is more useful shown
/// than withheld, so it passes through with <c>X-Data-Partial</c> for the client to warn on.</para>
/// </remarks>
public sealed class SurfaceCtrmFailuresAttribute : ActionFilterAttribute
{
    /// <summary>Header naming an incomplete-but-usable answer.</summary>
    public const string PartialHeader = "X-Data-Partial";

    public override async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var executed = await next();

        // An action that already failed has its own error; do not mask it with this one.
        if (executed.Exception is not null) return;

        var provenance = context.HttpContext.RequestServices.GetService<CtrmProvenance>();
        if (provenance is null) return;

        if (provenance.Partial)
            context.HttpContext.Response.Headers[PartialHeader] = "true";

        if (provenance.Failure is not { } failure) return;

        // Message is for a person: name the source and the category, never the producer or the query.
        throw new InfrastructureException(
            $"{Describe(failure.What)} could not be read from CTRM ({failure.Status}). "
            + "The data shown would be incomplete, so nothing is shown. Please retry shortly.",
            "INFRASTRUCTURE_CTRM_UNAVAILABLE",
            StatusCodes.Status503ServiceUnavailable);
    }

    private static string Describe(string what) => what switch
    {
        "contracts" => "Contracts",
        "tickets" => "Tickets",
        _ => "Contract and ticket data"
    };
}
