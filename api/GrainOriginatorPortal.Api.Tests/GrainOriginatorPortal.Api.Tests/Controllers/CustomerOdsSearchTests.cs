// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Guards the server-side minimum-length gate on the unscoped ODS onboarding search (AR-04). The
/// client already refuses to call below 3 chars, but the guard must hold at the boundary so a direct
/// API call with a 1–2 char term can't page broad producer-master PII out of the source system.
/// </summary>
public class CustomerOdsSearchTests
{
    private readonly Mock<ICustomerService> _serviceMock = new();
    private readonly CustomersController _sut;

    public CustomerOdsSearchTests()
    {
        _sut = new CustomersController(_serviceMock.Object);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("a")]
    [InlineData("ab")]
    [InlineData(" ab ")]   // trims to 2
    public async Task SearchOds_ShortOrBlankTerm_ReturnsEmpty_WithoutQueryingOds(string term)
    {
        var result = await _sut.SearchOds(term, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Empty(Assert.IsType<List<CustomerResponse>>(ok.Value));
        _serviceMock.Verify(s => s.SearchOdsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SearchOds_TermAtOrAboveMinimum_QueriesOds()
    {
        _serviceMock.Setup(s => s.SearchOdsAsync("abc", It.IsAny<CancellationToken>()))
            .ReturnsAsync([new CustomerResponse { Id = 1, Name = "Abcock Farms" }]);

        var result = await _sut.SearchOds("abc", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Single(Assert.IsType<List<CustomerResponse>>(ok.Value));
        _serviceMock.Verify(s => s.SearchOdsAsync("abc", It.IsAny<CancellationToken>()), Times.Once);
    }
}
