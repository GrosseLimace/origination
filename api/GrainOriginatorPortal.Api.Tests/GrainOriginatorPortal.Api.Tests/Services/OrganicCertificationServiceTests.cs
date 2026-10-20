// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

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

    /// <summary>Frozen clock, so the compliance-window maths is assertable rather than drifting
    /// with the calendar. Set deliberately close to the captured samples' dates.</summary>
    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static readonly DateTimeOffset Today = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

    private static OrganicCertificationService Service(
        ApplicationDbContext db, int? complianceWindowMonths = null)
    {
        var settings = new Dictionary<string, string?>();
        if (complianceWindowMonths is not null)
        {
            settings["OrganicCertification:ComplianceWindowMonths"] =
                complianceWindowMonths.Value.ToString();
        }

        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return new OrganicCertificationService(db, config, new FixedTimeProvider(Today));
    }

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
    public async Task TheComplianceSignalMeasuresTheCertifiersUpdatedOnDate()
    {
        // The desk's rule is "documentation current within 18 months". No certificate issue date
        // exists in queryable form, so Madeline Tatum chose the INTEGRITY profile's "updated on"
        // date (2026-10-01). Hofmeyer's real value is 2025-11-07 — 10 whole months before today,
        // so inside the window.
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.SourceLastUpdateDate = new DateTime(2025, 11, 7);
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.Equal(new DateTime(2025, 11, 7), result.SourceUpdatedOn);
        Assert.Equal(10, result.MonthsSinceSourceUpdate);
        Assert.False(result.OutsideComplianceWindow);
    }

    [Fact]
    public async Task ARecordUntouchedForLongerThanTheWindowIsFlagged()
    {
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.SourceLastUpdateDate = new DateTime(2025, 1, 15);   // 20 months before the frozen date
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.Equal(20, result.MonthsSinceSourceUpdate);
        Assert.True(result.OutsideComplianceWindow);
    }

    [Fact]
    public async Task ExactlyEighteenMonthsIsStillInsideTheWindow()
    {
        // The boundary, asserted explicitly because it is the easiest thing to get wrong and the
        // one a compliance conversation will eventually turn on.
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.SourceLastUpdateDate = new DateTime(2025, 4, 1);    // exactly 18 months
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.Equal(18, result.MonthsSinceSourceUpdate);
        Assert.False(result.OutsideComplianceWindow);
    }

    [Fact]
    public async Task AMissingUpdatedOnDateCountsAsOutsideTheWindow()
    {
        // Fails safe. We cannot show a trader "current" on the strength of a date we do not have,
        // and the panel should say unknown rather than imply zero months.
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.SourceLastUpdateDate = null;
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.Null(result.SourceUpdatedOn);
        Assert.Null(result.MonthsSinceSourceUpdate);
        Assert.True(result.OutsideComplianceWindow);
    }

    [Fact]
    public async Task TheWindowIsConfigurable()
    {
        // It is a business rule from their certifier, not a technical constant — it should be
        // movable without a deploy.
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.SourceLastUpdateDate = new DateTime(2025, 11, 7);   // 10 months
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var tightened = (await Service(db, complianceWindowMonths: 6)
            .GetForCustomerAsync(CustomerId)).Certification!;

        Assert.True(tightened.OutsideComplianceWindow);
    }

    [Fact]
    public async Task TheComplianceSignalAndTheAnniversaryDateCanDisagree()
    {
        // Worth pinning, because it is surprising and it is REAL: both captured samples sit inside
        // the 18-month window on "updated on" while already PAST their next scheduled annual
        // update. The chosen measure is the more permissive of the two, and anyone reading the
        // panel should not assume a green compliance signal means the annual update is current.
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.SourceLastUpdateDate = new DateTime(2025, 11, 7);   // inside the window
        cert.AnniversaryDate = new DateTime(2026, 4, 1);         // six months overdue
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.False(result.OutsideComplianceWindow);
        Assert.True(result.AnniversaryPastDue);
    }

    // ── AnniversaryPastDue ───────────────────────────────────────────────────────────────────
    // Moved here from the panel component on 2026-10-07, when it became a badge signal as well.
    // Two surfaces comparing the same date in the browser's timezone is how a badge ends up amber
    // while the panel behind it says the date is fine.

    [Fact]
    public async Task AnAnniversaryInThePastIsPastDue()
    {
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.AnniversaryDate = Today.UtcDateTime.Date.AddDays(-1);
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.True(result.AnniversaryPastDue);
    }

    [Fact]
    public async Task AnAnniversaryInTheFutureIsNotPastDue()
    {
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.AnniversaryDate = Today.UtcDateTime.Date.AddDays(1);
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.False(result.AnniversaryPastDue);
    }

    [Fact]
    public async Task TodayIsNotYetPastDue()
    {
        // The boundary. An update due today has not been missed, and a producer should not go amber
        // on the morning of the day it falls due.
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.AnniversaryDate = Today.UtcDateTime.Date;
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.False(result.AnniversaryPastDue);
    }

    [Fact]
    public async Task AMissingAnniversaryIsNotPastDue()
    {
        // ~15% of real records carry none. Absence is NOT lateness here — deliberately the opposite
        // of OutsideComplianceWindow, where a missing date does count, because that rule demands
        // positive proof of currency and we have none.
        using var db = NewContext();
        var cert = Certification(scopes: [Scope("Crops")]);
        cert.AnniversaryDate = null;
        db.OrganicCertifications.Add(cert);
        await db.SaveChangesAsync();

        var result = (await Service(db).GetForCustomerAsync(CustomerId)).Certification!;

        Assert.False(result.AnniversaryPastDue);
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
    public async Task UnresolvedStatusChangesListsOnlyWhatIsStillFlagged()
    {
        // The feed for the Actionable Insights alert. Only certifications that moved AND have not
        // returned to Certified appear — the same rule the profile badge uses, from one place.
        using var db = NewContext();
        db.Customers.Add(new Customer { Id = 600, ScoularId = "AAA111", NopIdNumber = "1111111111" });
        db.Customers.Add(new Customer { Id = 601, ScoularId = "BBB222", NopIdNumber = "2222222222" });
        db.Customers.Add(new Customer { Id = 602, ScoularId = "CCC333", NopIdNumber = "3333333333" });

        db.OrganicCertifications.AddRange(
            // Flagged: moved away from Certified and stayed there.
            new OrganicCertification
            {
                Nopid = "1111111111", OperationName = "Surrendered Farm",
                OperationStatus = "Surrendered", PreviousStatus = "Certified",
                StatusEffectiveDate = new DateTime(2026, 8, 3),
                StatusChangedOn = new DateTime(2026, 8, 5), UpdatedOn = new DateTime(2026, 9, 1),
            },
            // Not flagged: reinstated, so the change resolved itself.
            new OrganicCertification
            {
                Nopid = "2222222222", OperationName = "Reinstated Farm",
                OperationStatus = "Certified", PreviousStatus = "Suspended",
                UpdatedOn = new DateTime(2026, 9, 1),
            },
            // Not flagged: never changed on our watch.
            new OrganicCertification
            {
                Nopid = "3333333333", OperationName = "Steady Farm",
                OperationStatus = "Certified", PreviousStatus = null,
                UpdatedOn = new DateTime(2026, 9, 1),
            });
        await db.SaveChangesAsync();

        var changes = await Service(db).GetUnresolvedStatusChangesAsync();

        var change = Assert.Single(changes);
        Assert.Equal(600, change.CustomerId);
        Assert.Equal("AAA111", change.ScoularId);
        Assert.Equal("Surrendered", change.Status);
        Assert.Equal("Certified", change.PreviousStatus);
        Assert.Equal(new DateTime(2026, 8, 3), change.StatusEffectiveDate);
    }

    [Fact]
    public async Task OneChangedCertificationYieldsARowPerAffectedCustomer()
    {
        // A NOP id covering several customer records means several producers are affected, and
        // Insights is keyed by customer — so each needs its own alert rather than one shared row.
        using var db = NewContext();
        db.Customers.Add(new Customer { Id = 700, ScoularId = "FAM001", NopIdNumber = "4444444444" });
        db.Customers.Add(new Customer { Id = 701, ScoularId = "FAM002", NopIdNumber = "4444444444" });
        db.OrganicCertifications.Add(new OrganicCertification
        {
            Nopid = "4444444444", OperationName = "Family Operation",
            OperationStatus = "Revoked", PreviousStatus = "Certified",
            UpdatedOn = new DateTime(2026, 9, 1),
        });
        await db.SaveChangesAsync();

        var changes = await Service(db).GetUnresolvedStatusChangesAsync();

        Assert.Equal(2, changes.Count);
        Assert.Equal(["FAM001", "FAM002"], changes.Select(c => c.ScoularId));
    }

    [Fact]
    public async Task ACertificationWithNoMatchingCustomerIsNotReported()
    {
        // A NOP id for a producer we have not onboarded is stored on purpose, but there is nobody
        // to raise an alert against — it must not appear as a customerless row.
        using var db = NewContext();
        db.OrganicCertifications.Add(new OrganicCertification
        {
            Nopid = "9999999991", OperationStatus = "Surrendered", PreviousStatus = "Certified",
            UpdatedOn = new DateTime(2026, 9, 1),
        });
        await db.SaveChangesAsync();

        Assert.Empty(await Service(db).GetUnresolvedStatusChangesAsync());
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

    // ── Run completeness ─────────────────────────────────────────────────────────────────────
    //
    // The rules themselves are exhaustively covered in OrganicRunCompletenessTests, which needs no
    // database. These cover the wiring: that the right rows are selected, that ingest and skip rows
    // are counted together, and that the human-readable summary says the right thing.

    private static OrganicCertificationLoad Load(
        string? runId, int? position, int? total, string status = "Succeeded",
        string scoularId = "ABCFARM", DateTime? receivedOn = null) => new()
        {
            BatchId = Guid.NewGuid(),
            FeedRunId = runId,
            RunPosition = position,
            RunTotal = total,
            ScoularId = scoularId,
            Status = status,
            ReceivedOn = receivedOn ?? Today.UtcDateTime,
        };

    [Fact]
    public async Task AFinishedRunReportsComplete()
    {
        using var db = NewContext();
        db.OrganicCertificationLoads.AddRange(
            Load("run-a", 1, 3), Load("run-a", 2, 3), Load("run-a", 3, 3));
        await db.SaveChangesAsync();

        var result = await Service(db).GetRunCompletenessAsync("run-a");

        Assert.Equal("Complete", result.Outcome);
        Assert.Equal(3, result.RunTotal);
        Assert.Equal(0, result.MissingCount);
        Assert.Contains("Run finished", result.Summary);
    }

    [Fact]
    public async Task ASkipFillsItsPositionSoTheRunStillCompletes()
    {
        // The reason the skip endpoint exists, proved end to end through the database rather than
        // only in the rules.
        using var db = NewContext();
        db.OrganicCertificationLoads.AddRange(
            Load("run-b", 1, 3),
            Load("run-b", 2, 3, status: "Skipped", scoularId: "BFARM"),
            Load("run-b", 3, 3, scoularId: "CFARM"));
        await db.SaveChangesAsync();

        var result = await Service(db).GetRunCompletenessAsync("run-b");

        Assert.Equal("Complete", result.Outcome);
        Assert.Equal(1, result.Skipped);
        Assert.Contains("including 1 the sender skipped", result.Summary);
    }

    [Fact]
    public async Task AShortRunReportsIncompleteAndWarnsAgainstActingOnAbsence()
    {
        using var db = NewContext();
        db.OrganicCertificationLoads.AddRange(Load("run-c", 1, 3), Load("run-c", 2, 3));
        await db.SaveChangesAsync();

        var result = await Service(db).GetRunCompletenessAsync("run-c");

        Assert.Equal("Incomplete", result.Outcome);
        Assert.Equal([3], result.MissingPositions);
        Assert.Contains("Do not treat a producer's absence as meaningful", result.Summary);
    }

    [Fact]
    public async Task OnlyRowsForTheRequestedRunAreCounted()
    {
        // The obvious wiring bug: assessing every row in the table rather than one run's.
        using var db = NewContext();
        db.OrganicCertificationLoads.AddRange(
            Load("run-d", 1, 2), Load("run-d", 2, 2),
            Load("run-e", 1, 9));
        await db.SaveChangesAsync();

        var result = await Service(db).GetRunCompletenessAsync("run-d");

        Assert.Equal("Complete", result.Outcome);
        Assert.Equal(2, result.MessagesReceived);
    }

    [Fact]
    public async Task AReplayWithNoRunTotalIsNotAssessableRatherThanIncomplete()
    {
        // Replays and intraday edits carry no run fields. Note this is decided by the ABSENCE of a
        // total, not by the sender's "replay-" prefix — we never parse the run id.
        using var db = NewContext();
        db.OrganicCertificationLoads.AddRange(
            Load("replay-20261012T221421Z-d49ce704", null, null),
            Load("replay-20261012T221421Z-d49ce704", null, null));
        await db.SaveChangesAsync();

        var result = await Service(db).GetRunCompletenessAsync("replay-20261012T221421Z-d49ce704");

        Assert.Equal("NotAssessable", result.Outcome);
        Assert.Contains("Replays and intraday edits", result.Summary);
    }

    [Fact]
    public async Task AnUnknownRunIdIsNotAssessableRatherThanAnError()
    {
        using var db = NewContext();

        var result = await Service(db).GetRunCompletenessAsync("never-happened");

        Assert.Equal("NotAssessable", result.Outcome);
        Assert.Equal(0, result.MessagesReceived);
    }

    [Fact]
    public async Task AnEmptyRunIdIsHandledWithoutQuerying()
    {
        using var db = NewContext();

        var result = await Service(db).GetRunCompletenessAsync("   ");

        Assert.Equal("NotAssessable", result.Outcome);
        Assert.Contains("No feed run id", result.Summary);
    }

    [Fact]
    public async Task RecentRunsAreNewestFirstAndExcludeNonRuns()
    {
        using var db = NewContext();
        db.OrganicCertificationLoads.AddRange(
            Load("older", 1, 1, receivedOn: Today.UtcDateTime.AddDays(-2)),
            Load("newer", 1, 1, receivedOn: Today.UtcDateTime),
            // No total: a replay or intraday edit. Must not appear in a list of RUNS.
            Load("replay-x", null, null, receivedOn: Today.UtcDateTime.AddHours(-1)));
        await db.SaveChangesAsync();

        var runs = await Service(db).GetRecentRunsAsync();

        Assert.Equal(["newer", "older"], runs.Select(r => r.FeedRunId));
    }

    [Fact]
    public async Task RecentRunsClampsAnAbsurdTake()
    {
        using var db = NewContext();
        db.OrganicCertificationLoads.Add(Load("run-f", 1, 1));
        await db.SaveChangesAsync();

        Assert.Single(await Service(db).GetRecentRunsAsync(take: 100_000));
        Assert.Single(await Service(db).GetRecentRunsAsync(take: -5));
    }
}
