// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Interfaces;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class CustomersControllerTests
{
    private readonly Mock<IDataService> _dataServiceMock;
    private readonly Mock<IUserEntitlementService> _entitlementServiceMock;
    private readonly CustomersController _sut;

    public CustomersControllerTests()
    {
        _dataServiceMock = new Mock<IDataService>();
        _entitlementServiceMock = new Mock<IUserEntitlementService>();
        _sut = new CustomersController(_dataServiceMock.Object, _entitlementServiceMock.Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ReturnsOkWithCustomers()
    {
        // Arrange
        var customers = new List<Customer>
        {
            new Customer { Id = 1, Name = "Smith Farm", Location = "Omaha, NE", Phone = "", Email = "" },
            new Customer { Id = 2, Name = "Jones Farm", Location = "Lincoln, NE", Phone = "", Email = "" }
        };
        _dataServiceMock.Setup(s => s.GetCustomersAsync(null, It.IsAny<CancellationToken>())).ReturnsAsync(customers);

        // Act
        var result = await _sut.GetAll(null);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<Customer>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetById_WhenExists_ReturnsOk()
    {
        // Arrange
        var customer = new Customer { Id = 5, Name = "Test Farm", Location = "Test, NE", Phone = "", Email = "" };
        _dataServiceMock.Setup(s => s.GetCustomerByIdAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(customer);

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
        _dataServiceMock.Setup(s => s.GetCustomerByIdAsync(999, It.IsAny<CancellationToken>())).ReturnsAsync((Customer?)null);

        // Act & Assert
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetById(999));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Search_WithEmptyTerm_ReturnsGetCustomers()
    {
        // Arrange
        var customers = new List<Customer> { new Customer { Id = 1, Name = "Farm", Location = "", Phone = "", Email = "" } };
        _dataServiceMock.Setup(s => s.GetCustomersAsync(null, It.IsAny<CancellationToken>())).ReturnsAsync(customers);

        // Act
        var result = await _sut.Search("", null);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        _dataServiceMock.Verify(s => s.GetCustomersAsync(null, It.IsAny<CancellationToken>()), Times.Once);
        _dataServiceMock.Verify(s => s.SearchCustomersAsync(It.IsAny<string>(), It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Search_WithTerm_CallsSearchCustomers()
    {
        // Arrange
        var customers = new List<Customer>();
        _dataServiceMock.Setup(s => s.SearchCustomersAsync("Smith", null, It.IsAny<CancellationToken>())).ReturnsAsync(customers);

        // Act
        var result = await _sut.Search("Smith", null);

        // Assert
        Assert.IsType<OkObjectResult>(result.Result);
        _dataServiceMock.Verify(s => s.SearchCustomersAsync("Smith", null, It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetTradeUnits_ReturnsOkWithList()
    {
        // Arrange
        var units = new List<string> { "TU1", "TU2", "TU3" };
        _dataServiceMock.Setup(s => s.GetTradeUnitsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(units);

        // Act
        var result = await _sut.GetTradeUnits();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<string>>(ok.Value);
        Assert.Equal(3, returned.Count);
    }
}
