namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

/// <summary>
/// The customer segments a role may see (<c>dbo.RoleSegments</c>). Phase 5 gives each customer a segment;
/// until then every customer counts as <see cref="Producer"/>.
/// </summary>
public static class CustomerSegments
{
    public const string Producer = "Producer";
    public const string Commercial = "Commercial";

    public static IReadOnlyList<string> All { get; } = [Producer, Commercial];
}
