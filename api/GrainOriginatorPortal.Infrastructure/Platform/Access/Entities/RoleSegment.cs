namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

/// <summary>
/// <c>dbo.RoleSegments</c>: the customer segments a role may see (<see cref="CustomerSegments"/>). A SQL
/// temporal table, like <see cref="RolePermission"/>.
/// </summary>
public class RoleSegment
{
    public Guid RoleId { get; set; }
    public string Segment { get; set; } = string.Empty;
    public string GrantedBy { get; set; } = string.Empty;
    public DateTime GrantedAt { get; set; }

    public Role Role { get; set; } = null!;
}
