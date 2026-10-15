using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Idempotency;
using GrainOriginatorPortal.Mobile.Mapping;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Notes (card #644): operations <c>getRecentNotes</c> and <c>createNote</c>. Add and view only; no edit or delete on mobile.</summary>
[Route(RoutePrefix + "/customers/{customerId:long}/notes")]
[RequireTradeUnitEntitlement]
public sealed class MobileNotesController : MobileControllerBase
{
    public const int DefaultLimit = 10;
    public const int MaxLimit = 10;

    private readonly INoteService _notes;
    private readonly ICustomerService _customers;
    private readonly IIdempotencyStore _idempotency;
    private readonly IAuditScope _audit;

    public MobileNotesController(
        INoteService notes,
        ICustomerService customers,
        IIdempotencyStore idempotency,
        IAuditScope audit)
    {
        _notes = notes;
        _customers = customers;
        _idempotency = idempotency;
        _audit = audit;
    }

    /// <summary>Pinned note first (newest pinned if several), then the most recent notes up to the cap.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(RecentNotesDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<RecentNotesDto>> GetRecent(long customerId, [FromQuery] int? limit, CancellationToken cancellationToken)
    {
        var take = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);
        var all = await _notes.GetByCustomerAsync(customerId, cancellationToken);

        return Ok(BuildRecent(all.Where(n => !n.IsDeleted).Select(n => n.ToNote()), take));
    }

    [HttpPost]
    [ProducesResponseType(typeof(NoteDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(NoteDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<NoteDto>> Create(long customerId, [FromBody] NoteCreateRequest request, CancellationToken cancellationToken)
    {
        _audit.Entity("Note", null);

        if (_idempotency.TryGet<NoteDto>(UserKey, request.ClientRequestId, out var replay) && replay is not null)
        {
            // Offline replay of a request that already succeeded: same note, 200 not 201.
            return Ok(replay);
        }

        _ = await _customers.GetByIdAsync(customerId, cancellationToken)
            ?? throw new NotFoundException("Customer", customerId);

        // No @mentions on mobile in v1: the picker and the delivery paths are desktop features.
        var created = await _notes.CreateAsync(customerId, request.Content.Trim(), mentions: null, cancellationToken);

        var dto = created.ToNote();
        _audit.Entity("Note", created.Id);
        _audit.After(new { created.Id, created.CustomerId, request.CapturedAt, ContentLength = request.Content.Length });

        _idempotency.Set(UserKey, request.ClientRequestId, dto);
        return StatusCode(StatusCodes.Status201Created, dto);
    }

    internal static RecentNotesDto BuildRecent(IEnumerable<NoteDto> active, int take)
    {
        var list = active.ToList();
        var pinned = list.Where(n => n.IsPinned).OrderByDescending(n => n.CreatedAt).FirstOrDefault();
        var rest = list.Where(n => pinned is null || n.Id != pinned.Id).OrderByDescending(n => n.CreatedAt).ToList();

        return new RecentNotesDto
        {
            Pinned = pinned,
            Notes = rest.Take(take).ToList(),
            HasMore = rest.Count > take,
        };
    }
}
