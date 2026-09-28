// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class CustomersControllerTests
{
    private readonly Mock<ICustomerService> _serviceMock;
    private readonly CustomersController _sut;

    public CustomersControllerTests()
    {
        _serviceMock = new Mock<ICustomerService>();
        _sut = new CustomersController(_serviceMock.Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ReturnsOkWithCustomers()
    {
        // Arrange
        var customers = new List<CustomerResponse>
        {
            new() { Id = 1, Name = "Smith Farm", Location = "Omaha, NE" },
            new() { Id = 2, Name = "Jones Farm", Location = "Lincoln, NE" }
        };
        _serviceMock.Setup(s => s.GetAllAsync(null, It.IsAny<CancellationToken>())).ReturnsAsync(customers);

        // Act
        var result = await _sut.GetAll(null);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<CustomerResponse>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetById_WhenExists_ReturnsOk()
    {
        // Arrange
        var customer = new CustomerResponse { Id = 5, Name = "Test Farm", Location = "Test, NE" };
        _serviceMock.Setup(s => s.GetByIdAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(customer);

        // Act
        var result = await _sut.GetById(5);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(customer, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetById_WhenNotFound_ThrowsNotFoundException()
    {
        // Arrange
        _serviceMock.Setup(s => s.GetByIdAsync(999, It.IsAny<CancellationToken>())).ReturnsAsync((CustomerResponse?)null);

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetById(999));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Search_WithEmptyTerm_ReturnsGetCustomers()
    {
        // Arrange
        var customers = new List<CustomerResponse> { new() { Id = 1, Name = "Farm" } };
        _serviceMock.Setup(s => s.GetAllAsync(null, It.IsAny<CancellationToken>())).ReturnsAsync(customers);

        // Act
        var result = await _sut.Search("", null);

        // Assert
        Assert.IsType<OkObjectResult>(result.Result);
        _serviceMock.Verify(s => s.GetAllAsync(null, It.IsAny<CancellationToken>()), Times.Once);
        _serviceMock.Verify(s => s.SearchAsync(It.IsAny<string>(), It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Search_WithTerm_CallsSearchCustomers()
    {
        // Arrange
        _serviceMock.Setup(s => s.SearchAsync("Smith", null, It.IsAny<CancellationToken>())).ReturnsAsync(new List<CustomerResponse>());

        // Act
        var result = await _sut.Search("Smith", null);

        // Assert
        Assert.IsType<OkObjectResult>(result.Result);
        _serviceMock.Verify(s => s.SearchAsync("Smith", null, It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    // Trade-unit memberships: dormant-removal endpoint (new "removable once dormant" feature).
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetTradeUnits_ReturnsOkWithMembershipsIncludingActivityFlag()
    {
        // Arrange
        var tus = new List<CustomerTradeUnitInfo>
        {
            new() { TradeUnit = "2057", IsManual = false, HasOpenActivity = true },   // active-locked
            new() { TradeUnit = "2190", IsManual = false, HasOpenActivity = false },  // dormant → removable
        };
        _serviceMock.Setup(s => s.GetTradeUnitsAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(tus);

        // Act
        var result = await _sut.GetTradeUnits(7);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<CustomerTradeUnitInfo>>(ok.Value);
        Assert.Equal(2, returned.Count);
        Assert.Contains(returned, t => t.TradeUnit == "2190" && !t.HasOpenActivity);
        _serviceMock.Verify(s => s.GetTradeUnitMembershipsAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetTradeUnits_WithoutActivity_SkipsTheActivityCheck()
    {
        // The planting-intention picker only needs the codes. The activity check behind the default read
        // is a contract and ticket read for the producer - the seconds the picker used to wait.
        var tus = new List<CustomerTradeUnitInfo> { new() { TradeUnit = "2057", IsManual = false, IsActive = true } };
        _serviceMock.Setup(s => s.GetTradeUnitMembershipsAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(tus);

        var result = await _sut.GetTradeUnits(7, includeActivity: false);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Same(tus, ok.Value);
        _serviceMock.Verify(s => s.GetTradeUnitsAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RemoveDormantTradeUnit_WhenOk_ReturnsRefreshedList()
    {
        // Arrange
        _serviceMock.Setup(s => s.DeactivateDormantTradeUnitAsync(3, "2190", It.IsAny<CancellationToken>()))
            .ReturnsAsync(DeactivateTradeUnitResult.Ok);
        var refreshed = new List<CustomerTradeUnitInfo> { new() { TradeUnit = "2057", IsManual = false, HasOpenActivity = true } };
        _serviceMock.Setup(s => s.GetTradeUnitsAsync(3, It.IsAny<CancellationToken>())).ReturnsAsync(refreshed);

        // Act
        var result = await _sut.RemoveDormantTradeUnit(3, "2190");

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<CustomerTradeUnitInfo>>(ok.Value);
        Assert.Single(returned);
        _serviceMock.Verify(s => s.DeactivateDormantTradeUnitAsync(3, "2190", It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RemoveDormantTradeUnit_WhenStillActive_ReturnsConflictAndDoesNotRefresh()
    {
        // Arrange — server refuses because the producer still has open activity in that TU.
        _serviceMock.Setup(s => s.DeactivateDormantTradeUnitAsync(3, "2057", It.IsAny<CancellationToken>()))
            .ReturnsAsync(DeactivateTradeUnitResult.StillActive);

        // Act
        var result = await _sut.RemoveDormantTradeUnit(3, "2057");

        // Assert
        Assert.IsType<ConflictObjectResult>(result.Result);
        _serviceMock.Verify(s => s.GetTradeUnitsAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RemoveDormantTradeUnit_WhenNotFound_ThrowsNotFoundException()
    {
        // Arrange
        _serviceMock.Setup(s => s.DeactivateDormantTradeUnitAsync(9, "9999", It.IsAny<CancellationToken>()))
            .ReturnsAsync(DeactivateTradeUnitResult.NotFound);

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.RemoveDormantTradeUnit(9, "9999"));
    }
}
