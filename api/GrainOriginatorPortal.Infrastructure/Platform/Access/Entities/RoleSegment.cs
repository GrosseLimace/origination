namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

/// <summary>
/// <c>dbo.RoleSegments</c>: the customer segments a role may see (<see cref="CustomerSegments"/>). A SQL
/// temporal table, like <see cref="RolePermission"/>, and like it added or removed but never edited.
/// </summary>
public class RoleSegment
{
    public Guid RoleId { get; set; }
    public string Segment { get; set; } = string.Empty;

    /// <summary>Who granted it: a user's UPN from the grant editor, or the migration that seeded it.</summary>
    public string CreatedBy { get; set; } = string.Empty;

    /// <summary>When it was granted. Set by the database when the row is written.</summary>
    public DateTime CreatedAt { get; set; }

    public Role Role { get; set; } = null!;
}
