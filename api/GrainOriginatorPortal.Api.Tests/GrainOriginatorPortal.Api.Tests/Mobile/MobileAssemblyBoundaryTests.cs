// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.Authorization;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Mobile;
using GrainOriginatorPortal.Mobile.Authorization;
using GrainOriginatorPortal.Mobile.Controllers;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// Structural guarantees behind ADR-001: the mobile assembly can only reach the database through the
/// Application layer (never Infrastructure), and the desktop surface rejects mobile tokens by convention.
/// </summary>
public class MobileAssemblyBoundaryTests
{
    /// <summary>
    /// "All database access through the BLL" (SEC-ARCH-BURDI-001 invariant 2), checked at the type
    /// level. The Application layer's DTOs legitimately surface a few Infrastructure ENUMS (for
    /// example <c>ContractResponse.Status</c>), and touching one makes the compiler record an assembly
    /// reference, so an assembly-level "does not reference Infrastructure" check is too coarse. What
    /// must never appear in any mobile type's signature is a DbContext, a repository contract, or an
    /// entity class — the things that bypass the Application services.
    /// </summary>
    [Fact]
    public void MobileTypes_UseNoInfrastructureTypes_ExceptEnumsSurfacedByApplicationDtos()
    {
        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        var infrastructureTypes = typeof(MobileAssemblyMarker).Assembly.GetTypes()
            .SelectMany(t => Enumerable.Empty<Type>()
                .Concat(t.GetFields(all).Select(f => f.FieldType))
                .Concat(t.GetProperties(all).Select(p => p.PropertyType))
                .Concat(t.GetConstructors(all).SelectMany(c => c.GetParameters().Select(p => p.ParameterType)))
                .Concat(t.GetMethods(all).SelectMany(m => m.GetParameters().Select(p => p.ParameterType).Append(m.ReturnType)))
                .Concat(t.BaseType is { } b ? [b] : []))
            .SelectMany(Unwrap)
            .Where(x => x.Namespace?.StartsWith("GrainOriginatorPortal.Infrastructure", StringComparison.Ordinal) == true)
            .Distinct()
            .ToList();

        var offenders = infrastructureTypes
            .Where(x => !(x.IsEnum && x.Namespace == "GrainOriginatorPortal.Infrastructure.Data.Entities"))
            .Select(x => x.FullName)
            .OrderBy(x => x)
            .ToList();

        Assert.True(offenders.Count == 0,
            $"Mobile types must reach data only through Application services. Infrastructure types found in signatures: {string.Join(", ", offenders)}");

        Assert.Contains("GrainOriginatorPortal.Application",
            typeof(MobileAssemblyMarker).Assembly.GetReferencedAssemblies().Select(a => a.Name));
    }

    private static IEnumerable<Type> Unwrap(Type type)
    {
        if (type.IsByRef || type.IsArray || type.IsPointer)
        {
            type = type.GetElementType()!;
        }

        yield return type;

        if (type.IsGenericType)
        {
            foreach (var arg in type.GetGenericArguments().SelectMany(Unwrap))
            {
                yield return arg;
            }
        }
    }

    [Fact]
    public void MobileAssembly_DoesNotReferenceTheWebHost()
    {
        var referenced = typeof(MobileAssemblyMarker).Assembly.GetReferencedAssemblies().Select(a => a.Name);
        Assert.DoesNotContain("GrainOriginatorPortal.Api", referenced);
    }

    [Fact]
    public void MobileControllers_NeverTakeInfrastructureTypesInConstructors()
    {
        var offenders = MobileSurfaceConventionTests.MobileControllers()
            .SelectMany(t => t.GetConstructors().SelectMany(c => c.GetParameters()))
            .Where(p => p.ParameterType.Namespace?.StartsWith("GrainOriginatorPortal.Infrastructure", StringComparison.Ordinal) == true)
            .Select(p => $"{p.Member.DeclaringType?.Name}({p.ParameterType.Name})")
            .Distinct()
            .ToList();

        Assert.True(offenders.Count == 0, $"Mobile controllers depending on Infrastructure types: {string.Join(", ", offenders)}");
    }

    [Fact]
    public void DesktopAccessConvention_AddsPolicy_ToDesktopControllersOnly()
    {
        var convention = new DesktopAccessConvention();

        var desktop = new ControllerModel(typeof(NotesController).GetTypeInfo(), []);
        convention.Apply(desktop);
        Assert.Contains(desktop.Filters, f => f is AuthorizeFilter af
            && af.AuthorizeData?.Any(d => d.Policy == MobileAccess.DesktopPolicyName) == true);

        var mobile = new ControllerModel(typeof(MobileNotesController).GetTypeInfo(), []);
        convention.Apply(mobile);
        Assert.DoesNotContain(mobile.Filters, f => f is AuthorizeFilter);
    }
}
