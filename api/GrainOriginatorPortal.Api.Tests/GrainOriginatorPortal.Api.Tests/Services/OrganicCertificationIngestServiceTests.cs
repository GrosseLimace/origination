// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Exercises the certification ingest rules that matter to the feed: retry-safety, the deliberate
/// decision to accept a producer we have not onboarded, and the decision that one malformed child
/// must not lose a whole certification.
///
/// §8 DEVIATION — uses UseInMemoryDatabase, which style-guides/automated-testing.md §8 bans for DB
/// tests, matching the seven files already listed in the test project file. The behaviour under
/// test is service logic (validation, upsert-vs-insert, set replacement, what lands in the audit
/// row) rather than SQL, so the provider is not doing load-bearing work here. Note what that costs:
/// InMemory does not enforce the unique indexes, so RepostingTheSameProducerDoesNotDuplicate proves
/// the service looks up before inserting — it does NOT prove the database would have caught it.
/// Migrate with the rest when the real-SQL harness lands.
/// </summary>
public class OrganicCertificationIngestServiceTests
{
    private const string KnownScoularId = "ABCFARM";
    private const long KnownCustomerId = 4242;

    /// <summary>Frozen clock so UpdatedOn / ReceivedOn are assertable.</summary>
    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static readonly DateTimeOffset Now = new(2026, 9, 23, 14, 30, 0, TimeSpan.Zero);

    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"organicingest-{Guid.NewGuid()}")
            .Options);
        db.Customers.Add(new Customer
        {
            Id = KnownCustomerId,
            Name = "Prairie Ridge Farms",
            ScoularId = KnownScoularId,
        });
        db.SaveChanges();
        return db;
    }

    private static OrganicCertificationIngestService Service(ApplicationDbContext db) =>
        new(db, NullLogger<OrganicCertificationIngestService>.Instance, new FixedTimeProvider(Now));

    private static OrganicCertificationIngestRequest Request(
        string nopid = "1234567890",
        string scoularId = KnownScoularId,
        string? status = "Certified",
        DateTime? anniversary = null,
        IReadOnlyList<OrganicScopeDto>? scopes = null,
        IReadOnlyList<OrganicItemDto>? items = null) => new()
        {
            ScoularId = scoularId,
            Operation = new OrganicOperationDto
            {
                NopOperationId = nopid,
                OperationName = "Prairie Ridge Farms",
                CertifierName = "Example Certifiers LLC",
                NopOperationStatus = status,
                StatusEffectiveDate = new DateTime(2019, 3, 12, 8, 45, 0, DateTimeKind.Utc),
                NopAnniversaryDate = anniversary,
                HasCertificate = true,
                TotalAcreage = 640.5m,
            },
            Scopes = scopes,
            Items = items,
        };

    private static OrganicScopeDto Scope(string name, string status = "Certified") =>
        new() { NopScope = name, ScopeStatus = status };

    private static OrganicItemDto Item(string id, string? name = "Corn") =>
        new() { ItemId = id, ItemName = name, NopScope = "CROPS", Organic = true };

    [Fact]
    public async Task StoresTheOperationWithItsScopesAndItems()
    {
        using var db = NewContext();

        var result = await Service(db).IngestAsync(Request(
            scopes: [Scope("CROPS"), Scope("HANDLING")],
            items: [Item("I1"), Item("I2", "Soybeans")]));

        Assert.True(result.Accepted);
        Assert.True(result.CustomerMatched);
        Assert.Equal(2, result.ScopesStored);
        Assert.Equal(2, result.ItemsStored);
        Assert.Empty(result.Rejections);

        var stored = await db.OrganicCertifications
            .Include(c => c.Scopes).Include(c => c.Items)
            .SingleAsync();
        Assert.Equal("1234567890", stored.Nopid);
        Assert.Equal(KnownCustomerId, stored.CustomerId);
        Assert.Equal(Now.UtcDateTime, stored.UpdatedOn);
        Assert.Equal(result.BatchId, stored.LoadBatchId);
    }

    [Fact]
    public async Task RepostingTheSameProducerDoesNotDuplicate()
    {
        // The feed is a full nightly snapshot, so the same producer arrives every night and a
        // failed run gets replayed. Convergence rather than accumulation is the whole retry story.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(scopes: [Scope("CROPS")], items: [Item("I1")]));
        await service.IngestAsync(Request(scopes: [Scope("CROPS")], items: [Item("I1")]));

        Assert.Equal(1, await db.OrganicCertifications.CountAsync());
        Assert.Equal(1, await db.OrganicCertificationScopes.CountAsync());
        Assert.Equal(1, await db.OrganicCertificationItems.CountAsync());
    }

    [Fact]
    public async Task ChildrenAreReplacedAsASetSoRemovedItemsDisappear()
    {
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(items: [Item("I1"), Item("I2"), Item("I3")]));
        var result = await service.IngestAsync(Request(items: [Item("I2")]));

        Assert.Equal(1, result.ItemsStored);
        var remaining = await db.OrganicCertificationItems.Select(i => i.ItemId).ToListAsync();
        Assert.Equal(["I2"], remaining);
    }

    [Fact]
    public async Task UnmatchedCustomerIsStoredAndReportedNotRejected()
    {
        // A producer we have not onboarded is an onboarding gap, not a feed failure. Rejecting
        // would lose the certification until somebody noticed.
        using var db = NewContext();

        var result = await Service(db).IngestAsync(Request(scoularId: "NOBODY"));

        Assert.True(result.Accepted);
        Assert.False(result.CustomerMatched);

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Null(stored.CustomerId);
        Assert.Equal("NOBODY", stored.ScoularId);

        var audit = await db.OrganicCertificationLoads.SingleAsync();
        Assert.Equal(1, audit.UnmatchedCustomer);
        Assert.Equal(1, audit.Accepted);
    }

    [Fact]
    public async Task SurrenderedOperationWithNoItemsIsAccepted()
    {
        // Surrendered operations arrive with an empty item collection. Kate confirmed the business
        // archives certification documents separately, so no history is expected here.
        using var db = NewContext();

        var result = await Service(db).IngestAsync(Request(
            status: "Surrendered",
            scopes: [Scope("CROPS", "Surrendered")],
            items: []));

        Assert.True(result.Accepted);
        Assert.Equal(0, result.ItemsStored);
        Assert.Empty(result.Rejections);
        Assert.Equal("Surrendered", (await db.OrganicCertifications.SingleAsync()).OperationStatus);
    }

    [Fact]
    public async Task ScopesKeepTheirOwnStatusIndependently()
    {
        // The operation-level status is not the whole picture: a producer can be Certified for
        // CROPS and Surrendered for HANDLING at once, and a trader asking "can we move this
        // commodity" needs the scope, not the headline.
        using var db = NewContext();

        await Service(db).IngestAsync(Request(
            scopes: [Scope("CROPS", "Certified"), Scope("HANDLING", "Surrendered")]));

        var scopes = await db.OrganicCertificationScopes.ToListAsync();
        Assert.Equal("Certified", scopes.Single(s => s.Scope == "CROPS").ScopeStatus);
        Assert.Equal("Surrendered", scopes.Single(s => s.Scope == "HANDLING").ScopeStatus);
    }

    [Fact]
    public async Task AnAbsentCollectionDoesNotDeleteWhatIsAlreadyStored()
    {
        // The real cost of unknown-member Skip, found in review: if the sender renames "items" to
        // anything else, it binds as null — indistinguishable from a deliberate omission. Clearing
        // on null would turn a typo on their side into silent deletion of every stored crop, and
        // return "accepted": true while doing it. Under Disallow that typo would have been a 400.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(
            scopes: [Scope("CROPS")], items: [Item("I1"), Item("I2")]));

        // Same producer, but the sender's payload no longer carries either collection.
        var result = await service.IngestAsync(Request(scopes: null, items: null));

        Assert.True(result.Accepted);
        Assert.Equal(1, await db.OrganicCertificationScopes.CountAsync());
        Assert.Equal(2, await db.OrganicCertificationItems.CountAsync());

        // And it is reported rather than passing unnoticed.
        Assert.Contains(result.Rejections, r => r.Code == "SCOPES_ABSENT");
        Assert.Contains(result.Rejections, r => r.Code == "ITEMS_ABSENT");
    }

    [Fact]
    public async Task AnExplicitlyEmptyCollectionDoesClear()
    {
        // The counterpart, and the one that must keep working: an empty array is a real statement
        // rather than a missing one, and it is the normal shape for a surrendered operation.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(scopes: [Scope("CROPS")], items: [Item("I1")]));
        var result = await service.IngestAsync(Request(scopes: [], items: []));

        Assert.Equal(0, result.ScopesStored);
        Assert.Equal(0, result.ItemsStored);
        Assert.Empty(await db.OrganicCertificationScopes.ToListAsync());
        Assert.Empty(await db.OrganicCertificationItems.ToListAsync());
        Assert.Empty(result.Rejections);
    }

    [Fact]
    public async Task AFirstSightingIsNotAStatusChange()
    {
        // A brand-new operation has nothing to have changed from. Getting this wrong would put a
        // "status changed" flag on every producer the first night the feed runs.
        using var db = NewContext();

        await Service(db).IngestAsync(Request(status: "Certified"));

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Null(stored.PreviousStatus);
        Assert.Null(stored.StatusChangedOn);
    }

    [Fact]
    public async Task AChangedStatusCapturesWhatItChangedFromAndWhen()
    {
        // The desk asked to see not just THAT a status changed but what it changed FROM. The feed
        // sends current state only, so this is the one and only chance to record it.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(status: "Certified"));
        await service.IngestAsync(Request(status: "Surrendered"));

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Equal("Surrendered", stored.OperationStatus);
        Assert.Equal("Certified", stored.PreviousStatus);
        Assert.Equal(Now.UtcDateTime, stored.StatusChangedOn);
    }

    [Fact]
    public async Task AnUnchangedStatusLeavesTheTransitionAlone()
    {
        // The flag marks the last real transition, not the last message. Clearing these on every
        // nightly re-send would make the flag disappear the day after it appeared — exactly when
        // the desk needs to see it.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(status: "Certified"));
        await service.IngestAsync(Request(status: "Surrendered"));
        await service.IngestAsync(Request(status: "Surrendered"));
        await service.IngestAsync(Request(status: "Surrendered"));

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Equal("Certified", stored.PreviousStatus);
        Assert.Equal(Now.UtcDateTime, stored.StatusChangedOn);
    }

    [Fact]
    public async Task CasingAndPaddingDoNotManufactureAChange()
    {
        // Source formatting must not look like a certification event.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(status: "Certified"));
        await service.IngestAsync(Request(status: "  certified "));

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Null(stored.PreviousStatus);
        Assert.Null(stored.StatusChangedOn);
    }

    [Fact]
    public async Task ASecondChangeReplacesTheFirst()
    {
        // PreviousStatus is the status immediately before the current one, not the original.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(status: "Certified"));
        await service.IngestAsync(Request(status: "Suspended"));
        await service.IngestAsync(Request(status: "Revoked"));

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Equal("Revoked", stored.OperationStatus);
        Assert.Equal("Suspended", stored.PreviousStatus);
    }

    [Fact]
    public async Task AMissingStatusOnEitherSideIsNotATransition()
    {
        // "Changed from nothing" is not actionable, and the source omitting a status is a data gap
        // rather than a certification event. Neither direction should raise the flag.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(status: null));
        await service.IngestAsync(Request(status: "Certified"));

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Equal("Certified", stored.OperationStatus);
        Assert.Null(stored.PreviousStatus);

        await service.IngestAsync(Request(status: null));

        stored = await db.OrganicCertifications.SingleAsync();
        Assert.Null(stored.PreviousStatus);
        Assert.Null(stored.StatusChangedOn);
    }

    [Fact]
    public async Task TheEffectiveDateStaysSeparateFromWhenWeObservedTheChange()
    {
        // Two different questions, both wanted. The certifier's effective date is what the profile
        // displays ("Surrendered on 28 Feb"); StatusChangedOn is when the feed brought it to us,
        // which is what drives the "changed recently" signal.
        using var db = NewContext();
        var service = Service(db);

        await service.IngestAsync(Request(status: "Certified"));

        var backdated = Request(status: "Surrendered") with
        {
            Operation = Request().Operation with
            {
                NopOperationStatus = "Surrendered",
                StatusEffectiveDate = new DateTime(2026, 2, 28, 0, 0, 0, DateTimeKind.Utc),
            },
        };
        await service.IngestAsync(backdated);

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Equal(new DateTime(2026, 2, 28), stored.StatusEffectiveDate);
        Assert.Equal(Now.UtcDateTime, stored.StatusChangedOn);
        Assert.NotEqual(stored.StatusEffectiveDate, stored.StatusChangedOn);
    }

    [Fact]
    public async Task MissingNopIdRejectsTheMessageAndStillAudits()
    {
        // The one failure that loses the whole message: with no NOP id there is no key to store it
        // under. The audit row must still be written, or the sender's "it succeeded" and our
        // "nothing arrived" can never be reconciled.
        using var db = NewContext();

        var result = await Service(db).IngestAsync(Request(nopid: "   "));

        Assert.False(result.Accepted);
        Assert.Empty(await db.OrganicCertifications.ToListAsync());

        var rejection = Assert.Single(result.Rejections);
        Assert.Equal("MISSING_NOP_OPERATION_ID", rejection.Code);

        var audit = await db.OrganicCertificationLoads.SingleAsync();
        Assert.Equal("Rejected", audit.Status);
        Assert.Equal(0, audit.Accepted);
    }

    [Fact]
    public async Task DuplicateItemIdIsReportedWhileTheRestStores()
    {
        // One malformed child must not lose the certification. A silent drop would also hide a
        // sender-side bug, which is why the duplicate is named rather than de-duplicated quietly.
        using var db = NewContext();

        // Scopes sent as an explicit empty array, not omitted — this test is about duplicate
        // handling and should not incidentally exercise the absent-collection path.
        var result = await Service(db).IngestAsync(Request(
            scopes: [], items: [Item("I1"), Item("I1", "Duplicate"), Item("I2")]));

        Assert.True(result.Accepted);
        Assert.Equal(2, result.ItemsStored);

        var rejection = Assert.Single(result.Rejections, r => r.Code == "DUPLICATE_ITEM_ID");
        Assert.Equal("I1", rejection.Identifier);
    }

    [Fact]
    public async Task DuplicateScopeIsReportedWhileTheRestStores()
    {
        using var db = NewContext();

        var result = await Service(db).IngestAsync(Request(
            scopes: [Scope("CROPS"), Scope("crops"), Scope("HANDLING")], items: []));

        Assert.True(result.Accepted);
        Assert.Equal(2, result.ScopesStored);
        Assert.Single(result.Rejections, r => r.Code == "DUPLICATE_SCOPE");
    }

    [Fact]
    public async Task MissingAnniversaryDateIsStoredWithoutError()
    {
        // Roughly 15% of real records carry no anniversary date at all despite USDA marking the
        // field required, so the null branch is load-bearing rather than defensive.
        using var db = NewContext();

        var result = await Service(db).IngestAsync(Request(anniversary: null));

        Assert.True(result.Accepted);
        Assert.Null((await db.OrganicCertifications.SingleAsync()).AnniversaryDate);
    }

    [Fact]
    public async Task CalendarDatesAreStoredWithoutATimeComponent()
    {
        // These are calendar dates, not instants. Keeping a time on them is how a certificate
        // dated the 1st renders as the 30th for anyone west of UTC.
        using var db = NewContext();

        await Service(db).IngestAsync(Request(
            anniversary: new DateTime(2027, 1, 1, 23, 59, 0, DateTimeKind.Utc)));

        var stored = await db.OrganicCertifications.SingleAsync();
        Assert.Equal(new DateTime(2027, 1, 1), stored.AnniversaryDate);
        Assert.Equal(new DateTime(2019, 3, 12), stored.StatusEffectiveDate);
    }

    [Fact]
    public async Task AuditRecordsCountsAndNeverThePayload()
    {
        // Certification data is customer data. The audit answers "did it arrive and what happened"
        // — it is not a copy of the message.
        using var db = NewContext();

        await Service(db).IngestAsync(Request(
            scopes: [Scope("CROPS")],
            items: [Item("I1", "Corn"), Item("I2", "Soybeans")]));

        var audit = await db.OrganicCertificationLoads.SingleAsync();
        Assert.Equal("Succeeded", audit.Status);
        Assert.Equal("1234567890", audit.Nopid);
        Assert.Equal(Now.UtcDateTime, audit.ReceivedOn);

        Assert.NotNull(audit.Message);
        Assert.DoesNotContain("Corn", audit.Message);
        Assert.DoesNotContain("Soybeans", audit.Message);
        Assert.DoesNotContain("Prairie Ridge", audit.Message);
        Assert.DoesNotContain("Example Certifiers", audit.Message);
    }

    [Fact]
    public async Task CustomerCodeMatchesDespiteSourcePadding()
    {
        // ODS stores some customer codes CHAR-padded, so the sender may echo trailing spaces.
        using var db = NewContext();

        var result = await Service(db).IngestAsync(Request(scoularId: "  ABCFARM  "));

        Assert.True(result.CustomerMatched);
        Assert.Equal(KnownCustomerId, (await db.OrganicCertifications.SingleAsync()).CustomerId);
    }

    [Fact]
    public async Task SeveralCustomersSharingOneNopIdStillYieldOneCertificationRow()
    {
        // Family operations and person-plus-LLC pairs share a certificate. The read joins on NOP
        // id, so one row serves them all — this is why there is no junction table, and why the
        // open "one operation or several?" display question does not affect storage.
        using var db = NewContext();
        db.Customers.Add(new Customer { Id = 4243, Name = "Prairie Ridge LLC", ScoularId = "PRLLC" });
        await db.SaveChangesAsync();

        var service = Service(db);
        await service.IngestAsync(Request(scoularId: KnownScoularId));
        await service.IngestAsync(Request(scoularId: "PRLLC"));

        var certification = Assert.Single(await db.OrganicCertifications.ToListAsync());
        Assert.Equal("1234567890", certification.Nopid);
    }
}
