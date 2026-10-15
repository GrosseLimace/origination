// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Controllers;
using GrainOriginatorPortal.Mobile.Idempotency;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// A save from the phone must never overwrite what the desktop owns. The producer-details upsert
/// treats a null list as "not being edited, keep the stored rows". When the phone does send bin sites and
/// grain (editable on mobile since 2026-10-14) every field it read must reach the save, or desktop data is lost
/// (found while catching the mobile branch up with the 2026-10-13 bin-sites release).
/// </summary>
public class MobileProducerDetailsPreservationTests
{
    [Fact]
    public async Task Update_SendsTotalAcresOnly_AndLeavesSitesGrainAndContactsUntouched()
    {
        var current = new ProducerDetailsResponse
        {
            CustomerId = 42,
            CustomerName = "Producer A",
            TotalAcres = 900,
            PrimaryContact = "Pat",
            BinSites = [new BinSiteItemResponse { SiteKey = Guid.NewGuid(), Name = "Home", Capacity = 50_000 }],
            GrainOnFarm = [new GrainOnFarmItemResponse { CommodityCode = "YC", BinSiteName = "Home", BushelsOnHand = 10_000, BushelsSold = 4_000, LastBid = 4.12m }],
            Contacts = [new ContactItemResponse { Name = "Pat", Phone = "402-555-0100", IsPrimary = true }],
            CreatedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
            CreatedBy = "desk",
        };

        UpsertProducerDetailsRequest? sent = null;
        var service = new Mock<IProducerDetailsService>();
        service.Setup(s => s.GetByCustomerAsync(42, It.IsAny<CancellationToken>())).ReturnsAsync(current);
        service.Setup(s => s.UpsertAsync(42, It.IsAny<UpsertProducerDetailsRequest>(), It.IsAny<CancellationToken>()))
            .Callback<long, UpsertProducerDetailsRequest, CancellationToken>((_, r, _) => sent = r)
            .ReturnsAsync(current with { TotalAcres = 1200 });

        var sut = new MobileProducerDetailsController(
            service.Object, Mock.Of<ICustomerService>(), Mock.Of<IIdempotencyStore>(), new AuditScope())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var result = await sut.Update(42, new ProducerDetailsUpdateRequest { ClientRequestId = Guid.NewGuid(), TotalAcres = 1200 }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.NotNull(sent);
        Assert.Equal(1200, sent!.TotalAcres);
        Assert.Null(sent.GrainOnFarm);   // preserve: never re-sent from the phone
        Assert.Null(sent.BinSites);      // preserve
        Assert.Null(sent.Contacts);      // preserve (avoids the stale-copy overwrite the desktop fixed)
        Assert.Equal("Pat", sent.PrimaryContact);
    }

    [Fact]
    public async Task Update_WithContacts_PassesThemThrough_TrimmedAndBlanksCleared()
    {
        var current = new ProducerDetailsResponse { CustomerId = 42, CustomerName = "Producer A", CreatedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc), CreatedBy = "desk" };
        UpsertProducerDetailsRequest? sent = null;
        var service = new Mock<IProducerDetailsService>();
        service.Setup(s => s.GetByCustomerAsync(42, It.IsAny<CancellationToken>())).ReturnsAsync(current);
        service.Setup(s => s.UpsertAsync(42, It.IsAny<UpsertProducerDetailsRequest>(), It.IsAny<CancellationToken>()))
            .Callback<long, UpsertProducerDetailsRequest, CancellationToken>((_, r, _) => sent = r)
            .ReturnsAsync(current);
        var sut = new MobileProducerDetailsController(service.Object, Mock.Of<ICustomerService>(), Mock.Of<IIdempotencyStore>(), new AuditScope())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        await sut.Update(42, new ProducerDetailsUpdateRequest
        {
            ClientRequestId = Guid.NewGuid(),
            TotalAcres = 900,
            Contacts =
            [
                new ContactUpdateDto { Name = " Pat ", Phone = " 402-555-0100 ", Email = " ", IsPrimary = true },
                new ContactUpdateDto { Name = "Shop line", Phone = null, Email = "shop@x.com" },
            ],
        }, CancellationToken.None);

        Assert.NotNull(sent!.Contacts);
        Assert.Equal(2, sent.Contacts!.Count);
        Assert.Equal(("Pat", "402-555-0100", (string?)null, true), (sent.Contacts[0].Name, sent.Contacts[0].Phone, sent.Contacts[0].Email, sent.Contacts[0].IsPrimary));
        Assert.Equal(("Shop line", (string?)null, "shop@x.com", false), (sent.Contacts[1].Name, sent.Contacts[1].Phone, sent.Contacts[1].Email, sent.Contacts[1].IsPrimary));
        Assert.Null(sent.BinSites);   // not sent → preserved
        Assert.Null(sent.GrainOnFarm);
    }

    [Fact]
    public void Contact_RejectsABlankName()
    {
        var contact = new ContactUpdateDto { Name = "  " };
        Assert.Contains(contact.Validate(new(contact)), r => r.ErrorMessage == "Each contact needs a name.");
    }

    [Fact]
    public void Mapping_ExposesSitesAndGrainReadOnly_WithTotalCapacity()
    {
        var details = new ProducerDetailsResponse
        {
            CustomerId = 1,
            BinSites =
            [
                new BinSiteItemResponse { Name = "North", Capacity = 30_000, SortOrder = 2 },
                new BinSiteItemResponse { Name = "Home", Capacity = 20_000, SortOrder = 1 },
                new BinSiteItemResponse { Name = "Bag", Capacity = null, SortOrder = 3 },
            ],
            GrainOnFarm = [new GrainOnFarmItemResponse { CommodityCode = "SB", BinSiteName = "North", BushelsOnHand = 5, BushelsSold = 2 }],
        };

        var dto = GrainOriginatorPortal.Mobile.Mapping.MobileMappings.ToProducerDetails(details);

        Assert.Equal(["Home", "North", "Bag"], dto.BinSites.Select(s => s.Name).ToArray());
        Assert.Equal(50_000m, dto.TotalBinCapacity);
        Assert.Equal("North", dto.GrainOnFarm[0].BinSiteName);
        Assert.Equal(2m, dto.GrainOnFarm[0].BushelsSold);
    }

    [Fact]
    public async Task Update_WithSitesAndGrain_PassesEveryFieldThrough_AndStillPreservesContacts()
    {
        var siteKey = Guid.NewGuid();
        var current = new ProducerDetailsResponse
        {
            CustomerId = 42,
            CustomerName = "Producer A",
            CreatedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
            CreatedBy = "desk",
        };

        UpsertProducerDetailsRequest? sent = null;
        var service = new Mock<IProducerDetailsService>();
        service.Setup(s => s.GetByCustomerAsync(42, It.IsAny<CancellationToken>())).ReturnsAsync(current);
        service.Setup(s => s.UpsertAsync(42, It.IsAny<UpsertProducerDetailsRequest>(), It.IsAny<CancellationToken>()))
            .Callback<long, UpsertProducerDetailsRequest, CancellationToken>((_, r, _) => sent = r)
            .ReturnsAsync(current);

        var sut = new MobileProducerDetailsController(
            service.Object, Mock.Of<ICustomerService>(), Mock.Of<IIdempotencyStore>(), new AuditScope())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var request = new ProducerDetailsUpdateRequest
        {
            ClientRequestId = Guid.NewGuid(),
            TotalAcres = 900,
            BinSites = [new BinSiteDto { SiteKey = siteKey, Name = " Home ", Capacity = 50_000, Latitude = 41.2m, Longitude = -96.1m }],
            GrainOnFarm = [new GrainOnFarmItemDto { BinSiteKey = siteKey, BinSiteName = "ignored", CommodityCode = " YC ", BushelsOnHand = 10_000, BushelsSold = 4_000, TargetBushels = 4.5m, LastBid = 4.12m, Grade = "#2" }],
        };

        await sut.Update(42, request, CancellationToken.None);

        Assert.NotNull(sent);
        var site = Assert.Single(sent!.BinSites!);
        Assert.Equal(siteKey, site.SiteKey);
        Assert.Equal("Home", site.Name);
        Assert.Equal((50_000m, 41.2m, -96.1m), (site.Capacity!.Value, site.Latitude!.Value, site.Longitude!.Value));
        var grain = Assert.Single(sent.GrainOnFarm!);
        Assert.Equal(siteKey, grain.BinSiteKey);
        Assert.Equal("YC", grain.CommodityCode);
        Assert.Equal((10_000m, 4_000m, 4.5m, 4.12m, "#2"), (grain.BushelsOnHand!.Value, grain.BushelsSold!.Value, grain.TargetBushels!.Value, grain.LastBid!.Value, grain.Grade));
        Assert.Null(sent.Contacts);
    }

    [Fact]
    public void Mapping_RoundTripsSiteKeysCoordinatesAndLastBid()
    {
        var key = Guid.NewGuid();
        var dto = GrainOriginatorPortal.Mobile.Mapping.MobileMappings.ToProducerDetails(new ProducerDetailsResponse
        {
            CustomerId = 1,
            BinSites = [new BinSiteItemResponse { SiteKey = key, Name = "Home", Latitude = 41.2m, Longitude = -96.1m }],
            GrainOnFarm = [new GrainOnFarmItemResponse { BinSiteKey = key, CommodityCode = "YC", LastBid = -0.35m }],
        });

        Assert.Equal((key, 41.2m, -96.1m), (dto.BinSites[0].SiteKey!.Value, dto.BinSites[0].Latitude!.Value, dto.BinSites[0].Longitude!.Value));
        Assert.Equal((key, -0.35m), (dto.GrainOnFarm[0].BinSiteKey!.Value, dto.GrainOnFarm[0].LastBid!.Value));
    }

    [Fact]
    public void MobileLimits_MatchTheDesktopBinSiteRules()
    {
        Assert.Equal(GrainOriginatorPortal.Infrastructure.Data.Entities.BinSiteRules.MaxPerCustomer, MobileBinSiteLimits.MaxPerCustomer);
        Assert.Equal(GrainOriginatorPortal.Infrastructure.Data.Entities.BinSiteRules.NameMaxLength, MobileBinSiteLimits.NameMaxLength);
        Assert.Equal(GrainOriginatorPortal.Infrastructure.Data.Entities.BinSiteRules.MinLatitude, MobileBinSiteLimits.MinLatitude);
        Assert.Equal(GrainOriginatorPortal.Infrastructure.Data.Entities.BinSiteRules.MaxLatitude, MobileBinSiteLimits.MaxLatitude);
        Assert.Equal(GrainOriginatorPortal.Infrastructure.Data.Entities.BinSiteRules.MinLongitude, MobileBinSiteLimits.MinLongitude);
        Assert.Equal(GrainOriginatorPortal.Infrastructure.Data.Entities.BinSiteRules.MaxLongitude, MobileBinSiteLimits.MaxLongitude);
        Assert.Equal(GrainOriginatorPortal.Infrastructure.Data.Entities.BinSiteRules.MaxCapacity, MobileBinSiteLimits.MaxCapacity);
    }

    [Fact]
    public void BinSite_RejectsBlankNameAndHalfACoordinatePair()
    {
        var site = new BinSiteDto { Name = "  ", Latitude = 41m };
        var results = new List<System.ComponentModel.DataAnnotations.ValidationResult>();
        System.ComponentModel.DataAnnotations.Validator.TryValidateObject(site, new(site), results, validateAllProperties: true);
        results.AddRange(site.Validate(new(site)));

        Assert.Contains(results, r => r.ErrorMessage!.Contains("needs a name"));
        Assert.Contains(results, r => r.ErrorMessage!.Contains("both latitude and longitude"));
    }

    [Fact]
    public void Mapping_TotalCapacityIsNull_WhenNoSiteRecordsOne()
    {
        var dto = GrainOriginatorPortal.Mobile.Mapping.MobileMappings.ToProducerDetails(
            new ProducerDetailsResponse { CustomerId = 1, BinSites = [new BinSiteItemResponse { Name = "Bag" }] });

        Assert.Null(dto.TotalBinCapacity);
    }
}
