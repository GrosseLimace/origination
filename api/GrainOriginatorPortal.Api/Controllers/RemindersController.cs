// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Personal follow-up reminders an originator sets against a producer.
///
/// Unlike notes, reminders are NOT shared: every route acts on the caller own rows only, enforced
/// in the service and repository rather than here (see <see cref="IReminderService"/>). A reminder
/// belonging to another user is reported as 404 rather than 403, so the API never confirms that
/// someone else follow-up exists.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class RemindersController : ControllerBase
{
    private readonly IReminderService _service;
    private readonly ILogger<RemindersController> _logger;

    public RemindersController(IReminderService service, ILogger<RemindersController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>The caller own reminders for one producer, soonest due first.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<ReminderResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ReminderResponse>>> GetByCustomer(
        long customerId,
        [FromQuery] bool includeCompleted = false,
        CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByCustomerAsync(customerId, includeCompleted, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Every open reminder the caller owns ({id, customerId, customerCode, dueAt}) — the
    /// producer-list badge feed. Ships no reminder text; bounded by the caller own follow-ups.</summary>
    [HttpGet("mine")]
    [ProducesResponseType(typeof(List<ReminderDueResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ReminderDueResponse>>> GetMine(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetMineAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a follow-up reminder for a producer, owned by the caller.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ReminderResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReminderResponse>> Create([FromBody] CreateReminderRequest request, CancellationToken cancellationToken = default)
    {
        var reminder = await _service.CreateAsync(request, cancellationToken);
        _logger.LogInformation(
            "Reminder created [{ErrorCode}] [{ErrorCategory}]: ReminderId={ReminderId}, CustomerId={CustomerId}",
            "AUDIT_CREATE", "DataMutation", reminder.Id, request.CustomerId);
        return Created($"/api/reminders/{reminder.Id}", reminder);
    }

    // -------------------------------------------------------------------------
    /// <summary>Edits the due date, subject or notes of one of the caller own reminders.</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(ReminderResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReminderResponse>> Update(int id, [FromBody] UpdateReminderRequest request, CancellationToken cancellationToken = default)
    {
        var reminder = await _service.UpdateAsync(id, request, cancellationToken)
            ?? throw new NotFoundException("Reminder", id);
        _logger.LogInformation(
            "Reminder updated [{ErrorCode}] [{ErrorCategory}]: ReminderId={ReminderId}",
            "AUDIT_UPDATE", "DataMutation", reminder.Id);
        return Ok(reminder);
    }

    // -------------------------------------------------------------------------
    /// <summary>Marks one of the caller own reminders complete, or reopens it.</summary>
    [HttpPut("{id:int}/complete")]
    [ProducesResponseType(typeof(ReminderResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReminderResponse>> SetCompleted(int id, [FromBody] SetReminderCompletedRequest request, CancellationToken cancellationToken = default)
    {
        var reminder = await _service.SetCompletedAsync(id, request.IsCompleted, cancellationToken)
            ?? throw new NotFoundException("Reminder", id);
        _logger.LogInformation(
            "Reminder completion set [{ErrorCode}] [{ErrorCategory}]: ReminderId={ReminderId}, IsCompleted={IsCompleted}",
            "AUDIT_UPDATE", "DataMutation", reminder.Id, reminder.IsCompleted);
        return Ok(reminder);
    }

    // -------------------------------------------------------------------------
    // The old PUT {id}/outlook-event is gone. It existed so the browser could report back the event
    // id it had just created in Graph; the API writes the event itself now, so nothing calls it —
    // and an endpoint that let a client set an arbitrary event id is not worth keeping for its own
    // sake. The service method behind it survives, used by AddToOutlook.
    // -------------------------------------------------------------------------
    /// <summary>Deletes one of the caller own reminders.</summary>
    /// <summary>Puts an existing reminder on the caller's own Outlook calendar.
    /// <para>Replaces the old flow where the browser wrote the event itself and then told us the id.
    /// The API now does both, on-behalf-of the caller, so the browser never touches Graph.</para>
    /// <para>Always 200 for a reminder that exists: a calendar failure returns the reminder with no
    /// event id, and the row keeps offering the retry. The reminder is never at risk.</para></summary>
    [HttpPost("{id:int}/outlook")]
    [ProducesResponseType(typeof(ReminderResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReminderResponse>> AddToOutlook(
        int id, [FromBody] AddReminderToOutlookRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _service.AddToOutlookAsync(id, request, cancellationToken)
            ?? throw new NotFoundException("Reminder", id);
        return Ok(updated);
    }

    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        var deleted = await _service.DeleteAsync(id, cancellationToken);
        if (!deleted)
        {
            throw new NotFoundException("Reminder", id);
        }

        _logger.LogInformation(
            "Reminder deleted [{ErrorCode}] [{ErrorCategory}]: ReminderId={ReminderId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
