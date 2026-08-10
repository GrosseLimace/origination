namespace GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

/// <summary>Envelope for the <c>tickets</c> collection root field.</summary>
public sealed class CtrmTicketsResponse
{
    public CtrmPage<CtrmTicketDto>? Tickets { get; set; }
}

/// <summary>
/// A CTRM ticket header, from either the <c>tickets</c> collection or the single-ticket
/// <c>ticket(...)</c> root field.
/// </summary>
/// <remarks>
/// The header describes the load; the money and the producer live on <see cref="Details"/>. One
/// physical ticket can be split across many producers, so nothing on the header can be attributed to
/// an individual customer — <c>unloadQuantity</c> in particular is the whole load.
/// </remarks>
public sealed class CtrmTicketDto
{
    // The five-part composite key. Every detail row repeats all five, which is what lets us verify
    // the batching layer attached details to the right header.
    public string? TicketPrefix { get; set; }
    public string? TicketNumber { get; set; }
    public string? TicketSuffix { get; set; }
    public DateTime? TicketBLDate { get; set; }
    public string? ProductCode { get; set; }

    public string? ShipmentTicketNumber { get; set; }
    public string? LoadOrganizationCode { get; set; }
    public string? UnloadOrganizationCode { get; set; }
    public string? LoadElevatorCode { get; set; }

    public decimal? UnloadQuantity { get; set; }
    public decimal? LoadoutQuantity { get; set; }

    public List<CtrmTicketDetailDto> Details { get; set; } = [];
}

/// <summary>
/// One producer's share of a ticket.
/// </summary>
/// <remarks>
/// The grade-factor fields are the notable win: our ODS path reads these from a separate
/// <c>base.vw_TicketQuality</c> view and joins them back by ticket id. CTRM flattens them onto the
/// detail row, which removes that view and its join entirely.
/// </remarks>
public sealed class CtrmTicketDetailDto
{
    /// <summary>Distinguishes multiple detail rows on the same ticket — part of the synthetic id, or
    /// two producers on one ticket would collide.</summary>
    public int? TicketSequenceNumber { get; set; }

    /// <summary>The Scoular customer code. Same namespace as contract <c>customerId</c> and ODS
    /// <c>CustomerCode</c>.</summary>
    public string? CustomerCode { get; set; }

    public string? OrganizationCode { get; set; }
    public string? ElevatorCode { get; set; }
    public string? GradeCode { get; set; }

    /// <summary>Must include the prefix character (U/L/C/P/S/B) — <c>Ticket.IsApplied</c> is derived
    /// from it, so a number without the prefix would silently reclassify every ticket as applied.</summary>
    public string? ContractNumber { get; set; }

    public string? TicketType { get; set; }
    public string? TicketStatusCode { get; set; }
    public string? TicketStatusDescription { get; set; }

    public decimal? AppliedGrossQuantity { get; set; }
    public decimal? AppliedNetQuantity { get; set; }
    public decimal? AppliedDockQuantity { get; set; }
    public decimal? AppliedShrinkQuantity { get; set; }

    public decimal? FinalSettledNetQuantity { get; set; }
    public DateTime? FinalSettledDate { get; set; }
    public DateTime? TicketLastChangeDate { get; set; }

    public decimal? GradeFactorMoisturePercent { get; set; }
    public decimal? GradeFactorTestWeightPercent { get; set; }
    public decimal? GradeFactorProteinPercent { get; set; }

    public string? StorageProgramCode { get; set; }

    /// <summary>"Y" means cancelled. The ODS view pre-excludes these; whether the CTRM
    /// <c>tickets</c> field does is still unconfirmed, so the mapper drops them defensively.</summary>
    public string? CancelFlag { get; set; }

    public int? PriceSequence { get; set; }
}

/// <summary>
/// The five-part natural key identifying one CTRM ticket.
/// </summary>
/// <remarks>
/// Sourced from ODS, because CTRM's <c>tickets</c> field cannot be filtered by customer — ODS tells
/// us <em>which</em> tickets belong to a producer and CTRM supplies their current contents.
/// </remarks>
public sealed record CtrmTicketKey(string Prefix, string Number, string Suffix, string BlDate, string ProductCode);
