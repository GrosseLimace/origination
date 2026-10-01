namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A user allowed to flip their own session between ODS and CTRM for contracts and tickets.
/// </summary>
/// <remarks>
/// <para>Backs <c>dbo.CtrmSourceToggleUsers</c>. TEMPORARY by intent: it exists for the CTRM validation
/// window (from 2026-10-01), when a few testers compare CTRM against ODS on production data while everyone
/// else stays on the default. Once every user is on CTRM the table and the toggle can go. Rows are added by
/// SQL (see <c>docs/application-context/CTRM GraphQL Data Source.md</c>); there is no UI for it on purpose.</para>
///
/// <para><see cref="UserId"/> is the UPN (<c>preferred_username</c>, e.g. <c>CEgr@scoular.com</c>), matched
/// case-insensitively against the signed-in user. <see cref="IsActive"/> lets a tester be switched off
/// without losing the record of who was on the list and why.</para>
/// </remarks>
public class CtrmSourceToggleUser
{
    public int Id { get; set; }

    /// <summary>UPN of the tester, e.g. CEgr@scoular.com.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Display name, for the people reading the table.</summary>
    public string? DisplayName { get; set; }

    /// <summary>Why they are on the list / what they are validating.</summary>
    public string? Notes { get; set; }

    /// <summary>False switches the tester off without deleting the row.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
}
