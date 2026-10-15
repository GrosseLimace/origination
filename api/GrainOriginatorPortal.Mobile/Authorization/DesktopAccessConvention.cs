using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.Authorization;

namespace GrainOriginatorPortal.Mobile.Authorization;

/// <summary>
/// Adds the <see cref="MobileAccess.DesktopPolicyName"/> authorization filter to every controller
/// that is NOT in the mobile assembly. Existing <c>[Authorize]</c> attributes stay in force; this
/// filter is additive, so a request must satisfy both. One convention instead of 27 controller edits,
/// and a new desktop controller is covered automatically.
/// </summary>
public sealed class DesktopAccessConvention : IControllerModelConvention
{
    public void Apply(ControllerModel controller)
    {
        if (controller.ControllerType.Assembly == typeof(MobileAssemblyMarker).Assembly)
        {
            return;
        }

        controller.Filters.Add(new AuthorizeFilter(MobileAccess.DesktopPolicyName));
    }
}
