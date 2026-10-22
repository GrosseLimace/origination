using GrainOriginatorPortal.Api.Services.FdCic;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// The 45Z feedstock carbon-intensity calculator: USDA's FD-CIC method, scored on the server so every
/// score comes from one verified implementation and carries the version that produced it. Each crop
/// year uses the USDA version set in configuration (<c>FdCic:VersionByYear</c>); see docs/45z/README.md.
/// Scoring stores nothing.
/// </summary>
[Authorize]
[ApiController]
[Route("api/fd-cic")]
[Produces("application/json")]
public class FdCicController : ControllerBase
{
    private readonly IFdCicService _service;

    public FdCicController(IFdCicService service)
    {
        _service = service;
    }

    /// <summary>The USDA FD-CIC versions the API holds, which years use them, and whether each passed its test cases.</summary>
    [HttpGet("versions")]
    [ProducesResponseType(typeof(IReadOnlyList<FdCicVersionResponse>), StatusCodes.Status200OK)]
    public ActionResult<IReadOnlyList<FdCicVersionResponse>> GetVersions()
    {
        return Ok(_service.Versions());
    }

    /// <summary>Crop, cover crop, tillage and manure choices, and the states, for the year's version.</summary>
    [HttpGet("{year:int:range(2020,2100)}/options")]
    [ProducesResponseType(typeof(FdCicOptionsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public ActionResult<FdCicOptionsResponse> GetOptions(int year)
    {
        return Ok(_service.Options(year));
    }

    /// <summary>The counties the year's version can look up for a state (two-letter code).</summary>
    [HttpGet("{year:int:range(2020,2100)}/counties")]
    [ProducesResponseType(typeof(IReadOnlyList<string>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public ActionResult<IReadOnlyList<string>> GetCounties(int year, [FromQuery] string state)
    {
        if (string.IsNullOrWhiteSpace(state) || state.Length != 2)
            throw new Exceptions.ValidationException("state", "Use the two-letter state code.");
        return Ok(_service.Counties(year, state));
    }

    /// <summary>
    /// Scores one field. A crop and county USDA has no data for returns 200 with <c>scorable: false</c>
    /// and the reason; invalid input returns 400.
    /// </summary>
    [HttpPost("{year:int:range(2020,2100)}/score")]
    [ProducesResponseType(typeof(FdCicScoreResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public ActionResult<FdCicScoreResponse> Score(int year, [FromBody] FdCicScoreRequest request)
    {
        var input = new FdCicInput(
            request.Crop.Trim(),
            request.State.Trim(),
            request.County.Trim(),
            request.ActualYield,
            request.ExpectedYield,
            request.SyntheticN,
            request.NiFraction,
            request.CoverCrop.Trim(),
            request.Tillage.Trim(),
            request.Manure.Select(m => new FdCicManure(m.Amount, m.NContent)).ToList());
        return Ok(_service.Score(year, input));
    }
}
