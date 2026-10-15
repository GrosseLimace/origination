// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Controllers;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// The expanded contract reads its pricing lines from the producer-wide source (what the desktop and the cards use),
/// never the per-contract read, which is still delegated to ODS while the producer-wide one reads CTRM (2026-10-14).
/// </summary>
public class MobileContractsControllerTests
{
    [Fact]
    public async Task Detail_UsesTheProducerWidePricingLines_FilteredToThisContract()
    {
        var customers = new Mock<ICustomerService>();
        customers.Setup(s => s.GetByIdAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new CustomerResponse { Id = 7, Name = "P", ScoularId = "SC7" });

        var contracts = new Mock<IContractService>();
        contracts.Setup(s => s.GetByCustomerAsync(7, "SC7", It.IsAny<CancellationToken>())).ReturnsAsync(
        [
            new ContractResponse { Id = 1, ContractNumber = "W1", SourceContractId = "PCW1", PriceTypeCode = "U", Quantity = 100, IsActive = true },
        ]);
        contracts.Setup(s => s.GetPricingLinesByCustomerAsync("SC7", It.IsAny<CancellationToken>())).ReturnsAsync(
        [
            new ContractPricingLineResponse { ContractId = "PCW1", PriceSequence = 0, PriceQuantity = 0, BasisPrice = -0.2m },
            new ContractPricingLineResponse { ContractId = "PCW2", PriceSequence = 1, PriceQuantity = 50 },
        ]);

        var sut = new MobileContractsController(contracts.Object, customers.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var result = await sut.GetDetail(7, 1, CancellationToken.None);

        var detail = Assert.IsType<ContractDetailDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var line = Assert.Single(detail.PricingLines);
        Assert.Equal(-0.2m, line.BasisPrice);
        Assert.Equal(100m, line.Quantity); // a single zero-quantity line covers the whole contract
        contracts.Verify(s => s.GetPricingLinesAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
