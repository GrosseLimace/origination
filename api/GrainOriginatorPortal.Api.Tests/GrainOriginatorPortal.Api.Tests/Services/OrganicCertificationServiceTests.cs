// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The read side of organic certification: the three states the profile has to render, status per
/// scope, and crops grouped under the scope that certifies them.
///
/// §8 DEVIATION — UseInMemoryDatabase, matching the files already listed in the test project file.
/// What is under test is composition (which scope a crop lands under, which state is returned)
/// rather than SQL.
/// </summary>
public class OrganicCertificationServiceTests
{
    private const long CustomerId = 500;
    private const string Nopid = "8150000123";

    private static ApplicationDbContext NewContext(string? customerNopid = Nopid)
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"organicread-{Guid.NewGuid()}")
            .Options);

        db.Customers.Add(new Customer
        {
            Id = CustomerId,
            Name = "Hofmeyer Farms",
            ScoularId = "PRAI412",
            NopIdNumber = customerNopid,
        });
        db.SaveChanges();
        return db;
    }

    private static OrganicCertificationService Service(ApplicationDbContext db) => new(db);

    private static OrganicCertification Certification(
        string? status = "Certified",
        string? previousStatus = null,
        IEnumerable<OrganicCertificationScope>? scopes = null,
        IEnumerable<OrganicCertificationItem>? items = null) => new()
        {
            Nopid = Nopid,
            OperationName = "Hofmeyer Farms / Dale Hofmeyer",
            CertifierName = "[MCIA] Minnesota Crop Improvement Association",
            OperationStatus = status,
            PreviousStatus = previousStatus,
            StatusChangedOn = previousStatus is null ? null : new DateTime(2026, 9, 20),
            StatusEffectiveDate = new DateTime(2012, 1, 9),
            AnniversaryDate = new DateTime(2026, 4, 1),
            TotalAcreage = 1503.95m,
            UpdatedOn = new DateTime(2026, 9, 29),
            Scopes = scopes?.ToList() ?? [],
            Items = items?.ToList() ?? [],
        };

    private static OrganicCertificationScope Scope(string name, string? status = "Certified") =>
        new() { Scope = name, ScopeStatus = status, StatusEffectiveDate = new DateTime(2012, 1, 9) };

    [Fact]
    public async Task AProducerWithNoNopIdGetsARecordRatherThanA404()
    {
        // The badge can be showing on the industry code alone, which is legitimate — so this is not
        // a warning state and must not render as one.
        using var db = NewContext(customerNopid: null);

        var result = await Service(db).GetForCustomerAsync(CustomerId);

        Assert.Equal(CustomerId, result.CustomerId);
        Assert.Null(result.Nopid);
        Assert.False(result.NoCertificateOnFile);
        Assert.Null(result.Certification);
    }

    [Fact]
    public async Task ANopIdWithNothingBehindItIsFlaggedButStillShowsTheId()
    {
        // The desk's ask: show the NOP id as usual, and warn next to it. The sender filters out
        // operations holding no certifications, so this means either no current certificate or the
        // feed has not reached us — a trader wants to know either way.
        using var db = NewContext();

        var result = await Service(db).GetForCustomerAsync(CustomerId);

        Assert.Equal(Nopid, result.Nopid);
        Assert.True(result.NoCertificateOnFile);
        Assert.Null(result.Certification);
    }

    [Fact]
    public async Task ScopesCarryTheirOwnStatusIndependentlyOfTheOperation()
    {
        // The reason per-scope breakdown was asked for: the headline says Certified while Handling
        // is surrendered, and a trader moving a handled product needs the scope, not the headline.
        using var db = NewContext();
        db.OrganicCertifications.Add(Certification(
            status: "Certified",
            scopes: [Scope("Crops"), Scope("Handling", "Surrendered")]));
        await db.SaveChangesAsync();

        var result = await Service(db).GetForCustomerAsync(CustomerId);
        var cert = result.Certification!;

        Assert.True(cert.IsCertified);
        Assert.True(cert.Scopes.Single(s => s.Scope == "Crops").IsCertified);
        Assert.False(cert.Scopes.Single(s => s.Scope == "Handling").IsCertified);
        Assert.Equal("Surrendered", cert.Scopes.Single(s => s.Scope == "Handling").Status);
    }

    [Fact]
    public async Task FreeTextCropsAreSplitAndGroupedUnderTheirScope()
    {
        // The Hofmeyer shape: no catalogued items at all, every crop in free text.
        using var db = NewContext();
        db.OrganicCertifications.Add(Certification(
            scopes: [Scope("Crops"), Scope("Livestock")],
            items:
            [
                new OrganicCertificationItem
                {
                    Scope = "Crops",
                    OtherItems = "Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Soybeans",
                },
                new OrganicCertificationItem
                {
                    Scope = "Livestock",
                    OtherItems = "Milk, Dairy Cows (all eligible for organic slaughter)",
                },
            ]));
        await db.SaveChangesAsync();

        var result = await Service(db).GetForCustomerAsync(CustomerId);

        var crops = result.Certification!.Scopes.Single(s => s.Scope == "Crops").Crops;
        Assert.Contains("Oats", crops);
        Assert.Contains("Alfalfa", crops);
        Assert.Single(crops, c => c == "Alfalfa");          // deduplicated across the pairing
        Assert.DoesNotContain("Milk", crops);               // belongs to Livestock, not here

        var livestock = result.Certification.Scopes.Single(s => s.Scope == "Livestock").Crops;
        Assert.Contains("Dairy Cows (all eligible for organic slaughter)", livestock);
    }

    [Fact]
    public async Task CataloguedNamesAreUsedWithoutSplitting()
    {
        using var db = NewContext();
        db.OrganicCertifications.Add(Certification(
            scopes: [Scope("Crops")],
            items:
            [
                new OrganicCertificationItem { Scope = "Crops", ItemId = 377, ItemName = "Sugercane" },
                new OrganicCertificationItem { Scope = "Crops", ItemId = 363, ItemName = "Soybeans" },
            ]));
        await db.SaveChangesAsync();

        var result = await Service(db).GetForCustomerAsync(CustomerId);

        Assert.Equal(["Sugercane", "Soybeans"],
            result.Certification!.Scopes.Single(s => s.Scope == "Crops").Crops);
    }

    [Fact]
    public async Task AnItemNamingAnUndeclaredScopeStillAppears()
    {
        // Data inconsistency on the sender's side must not silently lose a crop. It gets its own
        // heading rather than being dropped or folded into an unrelated scope.
        using var db = NewContext();
        db.OrganicCertifications.Add(Certification(
            scopes: [Scope("Crops")],
            items:
            [
                new OrganicCertificationItem { Scope = "Crops", ItemName = "Corn" },
                new OrganicCertificationItem { Scope = "Wild Crops", ItemName = "Maple Syrup" },
            ]));
        await db.SaveChangesAsync();

        var result = await Service(db).GetForCustomerAsync(CustomerId);

        var wild = result.Certification!.Scopes.Single(s => s.Scope == "Wild Crops");
        Assert.Contains("Maple Syrup", wild.Crops);
        Assert.False(wild.IsCertified);   // no declared scope, so no status to certify it
    }

    [Fact]
    public async Task AnUnresolvedStatusChangeIsFlaggedWithWhatItChangedFrom()
    {
        using var db = NewContext();
        db.OrganicCertifications.Add(Certification(
            status: "Surrendered", previousStatus: "Certified", scopes: [Scope("Crops", "Surrendered")]));
        await db.SaveChangesAsync();

        var cert = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.True(cert.HasUnresolvedStatusChange);
        Assert.Equal("Certified", cert.PreviousStatus);
        Assert.False(cert.IsCertified);
    }

    [Fact]
    public async Task ReturningToCertifiedClearsTheFlagWithoutLosingTheHistory()
    {
        // The resolution rule: reinstatement clears the flag by itself. PreviousStatus is still
        // returned, so the panel can show history if it wants — it just stops warning.
        using var db = NewContext();
        db.OrganicCertifications.Add(Certification(
            status: "Certified", previousStatus: "Suspended", scopes: [Scope("Crops")]));
        await db.SaveChangesAsync();

        var cert = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.False(cert.HasUnresolvedStatusChange);
        Assert.Equal("Suspended", cert.PreviousStatus);
    }

    [Fact]
    public async Task SeveralCustomersSharingANopIdAllSeeTheSameCertification()
    {
        // Family operations and person-plus-LLC pairs share one certificate. The join is on NOP id,
        // so one row serves them all — no junction table, and the open question of how to PRESENT
        // that does not affect what is returned.
        using var db = NewContext();
        db.Customers.Add(new Customer
        {
            Id = 501, Name = "Hofmeyer LLC", ScoularId = "PRAI999", NopIdNumber = Nopid,
        });
        db.OrganicCertifications.Add(Certification(scopes: [Scope("Crops")]));
        await db.SaveChangesAsync();

        var first = await Service(db).GetForCustomerAsync(CustomerId);
        var second = await Service(db).GetForCustomerAsync(501);

        Assert.Equal(Nopid, first.Certification!.Nopid);
        Assert.Equal(Nopid, second.Certification!.Nopid);
        Assert.Equal(first.Certification.OperationName, second.Certification.OperationName);
    }

    [Fact]
    public async Task APaddedNopIdOnTheCustomerStillMatches()
    {
        using var db = NewContext(customerNopid: $"  {Nopid}  ");
        db.OrganicCertifications.Add(Certification(scopes: [Scope("Crops")]));
        await db.SaveChangesAsync();

        var result = await Service(db).GetForCustomerAsync(CustomerId);

        Assert.False(result.NoCertificateOnFile);
        Assert.NotNull(result.Certification);
    }
}
