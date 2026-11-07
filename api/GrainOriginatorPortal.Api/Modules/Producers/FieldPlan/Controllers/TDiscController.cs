using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Models.Responses;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.TDisc;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;


namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Controllers;

/// <summary>
/// USDA's T-DISC tillage rating, which a no-till or reduced-till 45Z field needs before its CI is confirmed
/// (7 CFR 2100.051). The review builds its pass table from these options; the rating is worked out on the
/// server at confirm (POST api/field-plan/records/{id}/confirm). See docs/45z/README.md.
/// </summary>
[RequirePermission(AppPermissions.Producers.FieldPlansRead)]
[ApiController]
[Route("api/tdisc")]
[Produces("application/json")]
public class TDiscController : ControllerBase
{
    private readonly ITDiscService _service;

    public TDiscController(ITDiscService service)
    {
        _service = service;
    }

    /// <summary>The tillage windows, the implements each allows, and USDA's operation lookup.</summary>
    [HttpGet("options")]
    [ProducesResponseType(typeof(TDiscOptionsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status503ServiceUnavailable)]
    public ActionResult<TDiscOptionsResponse> GetOptions()
    {
        return Ok(_service.Options());
    }
}
