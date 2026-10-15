// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Controllers;
using GrainOriginatorPortal.Mobile.Idempotency;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// Planting intentions from the phone (user 2026-10-15): edit crop, acres, crop year and type; add with a type and
/// a trade unit picked at sign-in (must be one the caller is entitled to).
/// </summary>
public class MobilePlantingIntentionsControllerTests
{
    private readonly Mock<IPlantingIntentionService> _plantings = new();
    private readonly Mock<ICommodityService> _commodities = new();
    private readonly Mock<ICustomerService> _customers = new();
    private readonly Mock<IUserEntitlementService> _entitlements = new();

    private MobilePlantingIntentionsController Create()
    {
        _plantings.Setup(s => s.GetByIdAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(new PlantingIntentionResponse
        {
            Id = 5, CustomerId = 7, Crop = "YC", Category = "Corn", Type = "Irrigated", Acres = 100, PlantingYear = 2026, TradeUnit = "2190",
            CreatedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
        });
        _plantings.Setup(s => s.UpdateAsync(5, It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((int id, string crop, string? category, string? type, string? description, int acres, int year, string? tu, CancellationToken _) =>
                new PlantingIntentionResponse { Id = id, CustomerId = 7, Crop = crop, Category = category, Type = type, Acres = acres, PlantingYear = year, TradeUnit = "2190" });
        _plantings.Setup(s => s.CreateAsync(7, It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((long customerId, string? name, string? code, string? tu, string crop, string? category, string? type, string? description, int acres, int year, CancellationToken _) =>
                new PlantingIntentionResponse { Id = 9, CustomerId = customerId, Crop = crop, Category = category, Type = type, Acres = acres, PlantingYear = year, TradeUnit = tu ?? "" });
        _commodities.Setup(s => s.GetPlantingAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([new CommodityResponse { Code = "SB", Name = "Soybeans", IsActive = true, PlantingCategory = "Soybeans" }]);
        _customers.Setup(s => s.GetByIdAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CustomerResponse { Id = 7, Name = "Test Farm" });
        _customers.Setup(s => s.GetTradeUnitsAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new CustomerTradeUnitInfo { TradeUnit = "2190", IsActive = true }]);
        _entitlements.Setup(s => s.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string> { "2190", "3811" });

        return new MobilePlantingIntentionsController(
            _plantings.Object, _customers.Object, _commodities.Object, _entitlements.Object,
            Mock.Of<IIdempotencyStore>(), new AuditScope())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    [Fact]
    public async Task Update_ChangesCropAcresAndCropYear_KeepingTypeAndTradeUnit()
    {
        var sut = Create();

        var result = await sut.Update(7, 5, new PlantingIntentionUpdateRequest { ClientRequestId = Guid.NewGuid(), Crop = "SB", Acres = 250, PlantingYear = 2027 }, CancellationToken.None);

        var dto = Assert.IsType<PlantingIntentionDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(("SB", 250, 2027, "Irrigated"), (dto.Crop, dto.Acres, dto.PlantingYear, dto.Type));
        _plantings.Verify(s => s.UpdateAsync(5, "SB", "Soybeans", "Irrigated", It.IsAny<string?>(), 250, 2027, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_WithoutAYear_KeepsTheIntentionsYear()
    {
        var sut = Create();

        await sut.Update(7, 5, new PlantingIntentionUpdateRequest { ClientRequestId = Guid.NewGuid(), Acres = 120 }, CancellationToken.None);

        _plantings.Verify(s => s.UpdateAsync(5, "YC", "Corn", "Irrigated", It.IsAny<string?>(), 120, 2026, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("dryland", "Dryland")]
    [InlineData("Double Crop", "Double Crop")]
    [InlineData("", null)]
    public async Task Update_SetsOrClearsTheType(string sent, string? stored)
    {
        var sut = Create();

        await sut.Update(7, 5, new PlantingIntentionUpdateRequest { ClientRequestId = Guid.NewGuid(), Acres = 100, Type = sent }, CancellationToken.None);

        _plantings.Verify(s => s.UpdateAsync(5, "YC", "Corn", stored, It.IsAny<string?>(), 100, 2026, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_RejectsATypeOutsideTheDesktopsChoices()
    {
        var sut = Create();

        await Assert.ThrowsAsync<ValidationException>(() =>
            sut.Update(7, 5, new PlantingIntentionUpdateRequest { ClientRequestId = Guid.NewGuid(), Acres = 100, Type = "Organic" }, CancellationToken.None));
    }

    [Fact]
    public async Task Create_UsesTheChosenTradeUnitAndType()
    {
        var sut = Create();

        var result = await sut.Create(7, new PlantingIntentionCreateRequest
        {
            ClientRequestId = Guid.NewGuid(), Crop = "SB", Acres = 400, PlantingYear = 2027, Type = "irrigated", TradeUnit = "3811",
        }, CancellationToken.None);

        var dto = Assert.IsType<PlantingIntentionDto>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(("3811", "Irrigated"), (dto.TradeUnit, dto.Type));
        _plantings.Verify(s => s.CreateAsync(7, "Test Farm", It.IsAny<string?>(), "3811", "SB", "Soybeans", "Irrigated", null, 400, 2027, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Create_RejectsATradeUnitTheCallerIsNotEntitledTo()
    {
        var sut = Create();

        await Assert.ThrowsAsync<ValidationException>(() => sut.Create(7, new PlantingIntentionCreateRequest
        {
            ClientRequestId = Guid.NewGuid(), Crop = "SB", Acres = 400, PlantingYear = 2027, TradeUnit = "9999",
        }, CancellationToken.None));
        _plantings.Verify(s => s.CreateAsync(It.IsAny<long>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_WithoutATradeUnit_UsesTheProducersFirstEntitledOne()
    {
        var sut = Create();

        await sut.Create(7, new PlantingIntentionCreateRequest { ClientRequestId = Guid.NewGuid(), Crop = "SB", Acres = 10, PlantingYear = 2027 }, CancellationToken.None);

        _plantings.Verify(s => s.CreateAsync(7, It.IsAny<string?>(), It.IsAny<string?>(), "2190", "SB", "Soybeans", null, null, 10, 2027, It.IsAny<CancellationToken>()), Times.Once);
    }
}
