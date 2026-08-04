// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Verifies every controller in the API is protected with [Authorize].
/// This acts as a security regression test — a failing test here means
/// an endpoint was accidentally left unauthenticated.
/// </summary>
public class ControllerAuthorizationTests
{
    public static IEnumerable<object[]> AllControllerTypes()
    {
        yield return new object[] { typeof(BidSheetController) };
        yield return new object[] { typeof(CommoditiesController) };
        yield return new object[] { typeof(ContractsController) };
        yield return new object[] { typeof(CustomersController) };
        yield return new object[] { typeof(DashboardPlantingEstimatesController) };
        yield return new object[] { typeof(DiagnosticsController) };
        yield return new object[] { typeof(DpContractsController) };
        yield return new object[] { typeof(FarmsController) };
        yield return new object[] { typeof(GeocodeController) };
        yield return new object[] { typeof(MeController) };
        yield return new object[] { typeof(NotesController) };
        yield return new object[] { typeof(PlantingIntentionsController) };
        yield return new object[] { typeof(ProducerDetailsController) };
        yield return new object[] { typeof(QueryLibraryController) };
        yield return new object[] { typeof(SavedListsController) };
        yield return new object[] { typeof(StoredGrainController) };
        yield return new object[] { typeof(TicketsController) };
        yield return new object[] { typeof(TradeUnitsController) };
        yield return new object[] { typeof(UsageDashboardController) };
        yield return new object[] { typeof(UserPreferencesController) };
        yield return new object[] { typeof(UserTradeUnitsController) };
    }

    [Theory]
    [MemberData(nameof(AllControllerTypes))]
    public void Controller_HasAuthorizeAttribute(Type controllerType)
    {
        var attrs = controllerType.GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true);
        Assert.True(attrs.Length > 0,
            $"{controllerType.Name} is missing [Authorize]. All controllers must require authentication.");
    }

    [Theory]
    [MemberData(nameof(AllControllerTypes))]
    public void Controller_InheritsFromControllerBase(Type controllerType)
    {
        Assert.True(typeof(ControllerBase).IsAssignableFrom(controllerType),
            $"{controllerType.Name} must inherit from ControllerBase.");
    }
}
