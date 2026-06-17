// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces — NSubstitute is the standard for NEW tests (automated-testing.md §6.1).
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Interfaces;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class CommoditiesControllerTests
{
    private readonly IDataService _dataService = Substitute.For<IDataService>();
    private readonly CommoditiesController _sut;

    public CommoditiesControllerTests()
    {
        _sut = new CommoditiesController(_dataService);
    }

    [Fact]
    public async Task GetAll_ReturnsOkWithCommoditiesFromTheDataService()
    {
        // Arrange
        var commodities = new List<Commodity>
        {
            new() { Id = 1, Code = "YC", Name = "Yellow Corn" },
            new() { Id = 2, Code = "HRWW", Name = "Hard Red Winter Wheat" },
        };
        _dataService.GetCommoditiesAsync(Arg.Any<CancellationToken>()).Returns(commodities);

        // Act
        var result = await _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<Commodity>>(ok.Value);
        Assert.Equal(2, returned.Count);
        Assert.Equal("YC", returned[0].Code);
    }

    [Fact]
    public async Task GetPlanting_ReturnsOnlyThePlantingCommoditiesFromTheDataService()
    {
        // Arrange
        var planting = new List<Commodity> { new() { Id = 2, Code = "HRWW", Name = "Hard Red Winter Wheat", ShowInPlantingIntentions = true } };
        _dataService.GetPlantingCommoditiesAsync(Arg.Any<CancellationToken>()).Returns(planting);

        // Act
        var result = await _sut.GetPlanting();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<Commodity>>(ok.Value);
        Assert.Single(returned);
        Assert.True(returned[0].ShowInPlantingIntentions);
    }
}
