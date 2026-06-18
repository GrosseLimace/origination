// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces — NSubstitute is the standard for NEW tests (automated-testing.md §6.1).
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

public class CommoditiesControllerTests
{
    private readonly ICommodityService _service = Substitute.For<ICommodityService>();
    private readonly CommoditiesController _sut;

    public CommoditiesControllerTests()
    {
        _sut = new CommoditiesController(_service);
    }

    [Fact]
    public async Task GetAll_ReturnsOkWithCommoditiesFromTheService()
    {
        // Arrange
        var commodities = new List<CommodityResponse>
        {
            new() { Id = 1, Code = "YC", Name = "Yellow Corn" },
            new() { Id = 2, Code = "HRWW", Name = "Hard Red Winter Wheat" },
        };
        _service.GetAllAsync(Arg.Any<CancellationToken>()).Returns(commodities);

        // Act
        var result = await _sut.GetAll();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<CommodityResponse>>(ok.Value);
        Assert.Equal(2, returned.Count);
        Assert.Equal("YC", returned[0].Code);
    }

    [Fact]
    public async Task GetPlanting_ReturnsOnlyThePlantingCommoditiesFromTheService()
    {
        // Arrange
        var planting = new List<CommodityResponse> { new() { Id = 2, Code = "HRWW", Name = "Hard Red Winter Wheat", ShowInPlantingIntentions = true } };
        _service.GetPlantingAsync(Arg.Any<CancellationToken>()).Returns(planting);

        // Act
        var result = await _sut.GetPlanting();

        // Assert
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var returned = Assert.IsType<List<CommodityResponse>>(ok.Value);
        Assert.Single(returned);
        Assert.True(returned[0].ShowInPlantingIntentions);
    }
}
