namespace GrainOriginatorPortal.Mobile;

/// <summary>
/// Anchor type for the mobile assembly: the host registers the controllers with
/// <c>AddApplicationPart(typeof(MobileAssemblyMarker).Assembly)</c>, and the convention tests
/// enumerate the assembly through it.
/// </summary>
public sealed class MobileAssemblyMarker
{
    private MobileAssemblyMarker() { }
}
