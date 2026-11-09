// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Producers.Controllers;
using GrainOriginatorPortal.Api.Modules.Contracts.Models.Responses;
using GrainOriginatorPortal.Api.Modules.Contracts.Services;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>Contract Pacing moved from ContractsController into Producers without changing its URL.</summary>
public class ContractPacingControllerTests
{
    [Fact]
    public void Route_IsStillApiContractsPacing()
    {
        var controllerRoute = typeof(ContractPacingController).GetCustomAttribute<RouteAttribute>()!.Template;
        var action = typeof(ContractPacingController).GetMethod(nameof(ContractPacingController.GetPacingHistorical))!;

        Assert.Equal("api/contracts", controllerRoute);
        Assert.Equal("pacing/{customerId:long}", action.GetCustomAttribute<HttpGetAttribute>()!.Template);
    }

    [Fact]
    public async Task GetPacingHistorical_ReturnsTheContractsServicesHistory()
    {
        var history = new List<ContractResponse> { new() };
        var contracts = Substitute.For<IContractService>();
        contracts.GetHistoricalForPacingAsync(260843, Arg.Any<CancellationToken>()).Returns(history);

        var result = await new ContractPacingController(contracts).GetPacingHistorical(260843);

        Assert.Same(history, Assert.IsType<OkObjectResult>(result.Result).Value);
    }
}
