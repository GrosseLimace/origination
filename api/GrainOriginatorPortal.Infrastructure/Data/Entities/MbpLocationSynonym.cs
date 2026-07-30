namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Location / elevator master — a faithful mirror of <c>TSCPRDLIB.MBPLOCSYN</c> (the bid-portal /
/// CTRM location-synonym table). Maps a <see cref="LocationId"/> (e.g. "1039-ABERD"), its numeric
/// <see cref="Location"/> and optional <see cref="Elevator"/> code, to a curated
/// <see cref="DisplayName"/> + address, plus status and audit columns.
///
/// Loaded from the periodic MBPLOCSYN export via a re-runnable SQL script and keyed on
/// <see cref="LocationId"/> so a re-load upserts by that key. Intended to give storage-location and
/// trade-unit-location display a more specific / correct source than the current ODS elevator /
/// location lookups. Columns mirror the source 1:1 (text stored as-is, trimmed; audit stamps as
/// datetimes).
/// </summary>
public class MbpLocationSynonym
{
    public int Id { get; set; }

    /// <summary>LOCATION_ID — the source key (e.g. "1039-ABERD" or a bare location code). Unique.</summary>
    public string LocationId { get; set; } = string.Empty;

    /// <summary>LOCATION — the numeric location/division code.</summary>
    public string? Location { get; set; }
    /// <summary>ELEVATOR — elevator code (set on a subset of rows).</summary>
    public string? Elevator { get; set; }
    /// <summary>DISPLAY_NAME — curated location name (e.g. "Aberdeen, ID").</summary>
    public string? DisplayName { get; set; }

    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? Country { get; set; }
    public string? ZipCode { get; set; }
    public string? Phone { get; set; }
    public string? Fax { get; set; }
    public string? Email { get; set; }
    public string? Website { get; set; }

    /// <summary>PUSH_NOTIFICATIONS_HIDDEN — "Y" / "N".</summary>
    public string? PushNotificationsHidden { get; set; }
    /// <summary>CASH_BIDS_HIDDEN — "Y" / "N".</summary>
    public string? CashBidsHidden { get; set; }
    /// <summary>STATUS — "ACTIVE" / "DISABLED" / blank.</summary>
    public string? Status { get; set; }

    public string? DeletedByUser { get; set; }
    public DateTime? DeletedAtSvStamp { get; set; }
    public string? CreatedByUser { get; set; }
    public DateTime? CreatedStamp { get; set; }
    public string? ChangedByUser { get; set; }
    public DateTime? ChangeStamp { get; set; }
}
