// System namespaces
using System.ComponentModel.DataAnnotations;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.FieldPlan;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// The field plan: producers' fields (CTRM splits), their crop-row seasons, sustainability program records
/// (45Z, GrainCraft) and program enrollments. One route per method of the client's FieldPlanBackend
/// (client/.../field-plan/store/field-plan-backend.ts). Rules live in <see cref="FieldPlanService"/>; every
/// write is audit-logged there.
///
/// Open to any signed-in originator, like planting intentions: no per-producer object-level authorization by
/// design (SECURITY-REVIEWS/ACCEPTED-RISKS.md AR-01 collaborative edit, AR-02 reads not limited by trade unit).
/// </summary>
[ApiController]
[Route("api/field-plan")]
[Authorize]
[Produces("application/json")]
public class FieldPlanController : ControllerBase
{
    private readonly IFieldPlanService _service;
    private readonly IFieldTicketService _tickets;

    public FieldPlanController(IFieldPlanService service, IFieldTicketService tickets)
    {
        _service = service;
        _tickets = tickets;
    }

    /// <summary>Everything one producer has: fields, seasons, records and enrollments (withdrawn included).</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(FieldPlanSnapshotResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<FieldPlanSnapshotResponse>> Load(long customerId, CancellationToken ct) =>
        Ok(await _service.LoadAsync(customerId, ct));

    // ── Fields and seasons ───────────────────────────────────────────────────

    /// <summary>Adds one of the producer's CTRM splits as a field (name, split % and date from CTRM).</summary>
    [HttpPost("fields")]
    [ProducesResponseType(typeof(ProducerFieldResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<ProducerFieldResponse>> CreateField([FromBody] CreateProducerFieldRequest request, CancellationToken ct) =>
        Ok(await _service.CreateFieldAsync(request, ct));

    /// <summary>Sets a field's state and county.</summary>
    [HttpPut("fields/{splitId}")]
    [ProducesResponseType(typeof(ProducerFieldResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProducerFieldResponse>> UpdateField([StringLength(20)] string splitId, [FromBody] UpdateProducerFieldRequest request, CancellationToken ct) =>
        Ok(await _service.UpdateFieldAsync(splitId, request, ct));

    /// <summary>Puts a field on a crop row for a year.</summary>
    [HttpPost("seasons")]
    [ProducesResponseType(typeof(FieldSeasonResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<FieldSeasonResponse>> AddSeason([FromBody] CreateFieldSeasonRequest request, CancellationToken ct) =>
        Ok(await _service.AddSeasonAsync(request, ct));

    /// <summary>Changes a field's acres on a crop row; refused once its harvest estimate is locked.</summary>
    [HttpPut("seasons/{id:int}")]
    [ProducesResponseType(typeof(FieldSeasonResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<FieldSeasonResponse>> UpdateSeason(int id, [FromBody] UpdateFieldSeasonRequest request, CancellationToken ct) =>
        Ok(await _service.UpdateSeasonAsync(id, request, ct));

    /// <summary>Takes a field off a crop row, with its unlocked program records.</summary>
    [HttpDelete("seasons/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> RemoveSeason(int id, CancellationToken ct)
    {
        await _service.RemoveSeasonAsync(id, ct);
        return NoContent();
    }

    // ── Program records ─────────────────────────────────────────────────────

    [HttpPost("records")]
    [ProducesResponseType(typeof(FieldProgramRecordResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<FieldProgramRecordResponse>> AddRecord([FromBody] CreateFieldProgramRecordRequest request, CancellationToken ct) =>
        Ok(await _service.AddRecordAsync(request, ct));

    [HttpPut("records/{id:int}")]
    [ProducesResponseType(typeof(FieldProgramRecordResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<FieldProgramRecordResponse>> UpdateRecord(int id, [FromBody] UpdateFieldProgramRecordRequest request, CancellationToken ct) =>
        Ok(await _service.UpdateRecordAsync(id, request, ct));

    [HttpDelete("records/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> RemoveRecord(int id, CancellationToken ct)
    {
        await _service.RemoveRecordAsync(id, ct);
        return NoContent();
    }

    /// <summary>Locks the harvest estimate, rescored on the server. Always an estimate, never an official result.</summary>
    [HttpPost("records/{id:int}/lock")]
    [ProducesResponseType(typeof(FieldProgramRecordResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<FieldProgramRecordResponse>> Lock(int id, CancellationToken ct) =>
        Ok(await _service.LockAsync(id, ct));

    /// <summary>Unlocks a harvest estimate with a reason; refused while an attested enrollment holds it.</summary>
    [HttpPost("records/{id:int}/reopen")]
    [ProducesResponseType(typeof(FieldPlanReopenResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<FieldPlanReopenResponse>> Reopen(int id, [FromBody] FieldPlanReasonRequest request, CancellationToken ct) =>
        Ok(await _service.ReopenAsync(id, request.Reason, ct));

    /// <summary>
    /// The field's CTRM tickets for its crop and crop year, settled or not: delivered under its split ID, on a
    /// contract for that crop year or with a BL date in the crop year's window. For the 45Z review.
    /// </summary>
    [HttpGet("records/{id:int}/tickets")]
    [ProducesResponseType(typeof(FieldTicketsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<FieldTicketsResponse>> Tickets(int id, CancellationToken ct) =>
        Ok(await _tickets.ForRecordAsync(id, ct));

    /// <summary>
    /// Confirms a 45Z field after harvest with the producer: the actual yield and the tickets to include. The
    /// CI is rescored and locked, and the confirmed CI with its bushels and tickets is the official result.
    /// </summary>
    [HttpPost("records/{id:int}/confirm")]
    [ProducesResponseType(typeof(FieldProgramRecordResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<FieldProgramRecordResponse>> Confirm(int id, [FromBody] ConfirmFieldProgramRecordRequest request, CancellationToken ct) =>
        Ok(await _service.ConfirmAsync(id, request, ct));

    // ── Enrollments ─────────────────────────────────────────────────────────

    /// <summary>The producer's live enrollment, created if needed. 204 for a program without enrollment.</summary>
    [HttpPost("enrollments")]
    [ProducesResponseType(typeof(ProgramEnrollmentResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> EnsureEnrollment([FromBody] EnsureProgramEnrollmentRequest request, CancellationToken ct) =>
        await _service.EnsureEnrollmentAsync(request, ct) is { } enrollment ? Ok(enrollment) : NoContent();

    [HttpPut("enrollments/{key:guid}/attestation")]
    [ProducesResponseType(typeof(ProgramEnrollmentResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ProgramEnrollmentResponse>> UpdateAttestation(Guid key, [FromBody] UpdateAttestationRequest request, CancellationToken ct) =>
        Ok(await _service.UpdateAttestationAsync(key, request.Attestation, ct));

    [HttpPost("enrollments/{key:guid}/attest")]
    [ProducesResponseType(typeof(ProgramEnrollmentResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<ProgramEnrollmentResponse>> Attest(Guid key, [FromBody] AttestEnrollmentRequest request, CancellationToken ct) =>
        Ok(await _service.AttestAsync(key, request.Listed, ct));

    [HttpPut("enrollments/{key:guid}/harvest-complete")]
    [ProducesResponseType(typeof(ProgramEnrollmentResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ProgramEnrollmentResponse>> SetHarvestComplete(Guid key, [FromBody] HarvestCompleteRequest request, CancellationToken ct) =>
        Ok(await _service.SetHarvestCompleteAsync(key, request.Complete, ct));

    [HttpPost("enrollments/{key:guid}/withdraw")]
    [ProducesResponseType(typeof(ProgramEnrollmentResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ProgramEnrollmentResponse>> Withdraw(Guid key, [FromBody] FieldPlanReasonRequest request, CancellationToken ct) =>
        Ok(await _service.WithdrawAsync(key, request.Reason, ct));
}
