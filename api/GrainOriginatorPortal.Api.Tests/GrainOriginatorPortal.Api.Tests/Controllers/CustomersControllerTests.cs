// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Interfaces;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class CustomersControllerTests
{
    private readonly Mock<IDataService> _dataServiceMock;
    private readonly CustomersController _sut;

    public CustomersControllerTests()
    {
        _dataServiceMock = new Mock<IDataService>();
        _sut = new CustomersController(_dataServiceMock.Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetAll_ReturnsOkWithCustomers()
    {
        // Arrange
        var customers = new List<Customer>
        {
            new Customer { Id = 1, Name = "Smith Farm", Location = "Omaha, NE", Phone = "", Email = "" },
            new Customer { Id = 2, Name = "Jones Farm", Location = "Lincoln, NE", Phone = "", Email = "" }
        };
        _dataServiceMock.Setup(s => s.GetCustomers(null)).Returns(customers);

        // Act
        var result = _sut.GetAll(null);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<Customer>>(ok.Value);
        Assert.Equal(2, returned.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetById_WhenExists_ReturnsOk()
    {
        // Arrange
        var customer = new Customer { Id = 5, Name = "Test Farm", Location = "Test, NE", Phone = "", Email = "" };
        _dataServiceMock.Setup(s => s.GetCustomerById(5)).Returns(customer);

        // Act
        var result = _sut.GetById(5);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(customer, ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetById_WhenNotFound_ReturnsNotFound()
    {
        // Arrange
        _dataServiceMock.Setup(s => s.GetCustomerById(999)).Returns((Customer?)null);

        // Act
        var result = _sut.GetById(999);

        // Assert
        Assert.IsType<NotFoundResult>(result.Result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Search_WithEmptyTerm_ReturnsGetCustomers()
    {
        // Arrange
        var customers = new List<Customer> { new Customer { Id = 1, Name = "Farm", Location = "", Phone = "", Email = "" } };
        _dataServiceMock.Setup(s => s.GetCustomers(null)).Returns(customers);

        // Act
        var result = _sut.Search("", null);

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        _dataServiceMock.Verify(s => s.GetCustomers(null), Times.Once);
        _dataServiceMock.Verify(s => s.SearchCustomers(It.IsAny<string>(), It.IsAny<List<string>?>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Search_WithTerm_CallsSearchCustomers()
    {
        // Arrange
        var customers = new List<Customer>();
        _dataServiceMock.Setup(s => s.SearchCustomers("Smith", null)).Returns(customers);

        // Act
        var result = _sut.Search("Smith", null);

        // Assert
        Assert.IsType<OkObjectResult>(result.Result);
        _dataServiceMock.Verify(s => s.SearchCustomers("Smith", null), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GetTradeUnits_ReturnsOkWithList()
    {
        // Arrange
        var units = new List<string> { "TU1", "TU2", "TU3" };
        _dataServiceMock.Setup(s => s.GetTradeUnits()).Returns(units);

        // Act
        var result = _sut.GetTradeUnits();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsAssignableFrom<List<string>>(ok.Value);
        Assert.Equal(3, returned.Count);
    }
}
