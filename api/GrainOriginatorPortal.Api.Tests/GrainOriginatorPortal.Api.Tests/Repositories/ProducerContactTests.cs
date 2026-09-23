// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Exercises the producer-contact replace-on-upsert + compose-on-read added to
/// <see cref="ProducerDetailsRepository"/>: primary enforcement, the dual-write into the legacy
/// PrimaryContact/PrimaryPhone columns, and the null-Contacts-preserves-rows rule that protects
/// old-shape client payloads during a deploy window.
/// </summary>
public class ProducerContactTests
{
    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"producercontact-{Guid.NewGuid()}")
            .Options);
        db.Customers.Add(new Customer { Id = 100, Name = "Smith Farm", ScoularId = "S1" });
        db.SaveChanges();
        return db;
    }

    private static ProducerDetailsRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<ProducerDetailsRepository>.Instance);

    private static ProducerContactEntry Contact(string name, string? phone = null,
        string? email = null, bool isPrimary = false) =>
        new() { Name = name, Phone = phone, Email = email, IsPrimary = isPrimary };

    private static ProducerDetailsUpsertArgs Args(IReadOnlyList<ProducerContactEntry>? contacts,
        string? legacyContact = null, string? legacyPhone = null) =>
        new()
        {
            CustomerId = 100, ScoularId = "S1", CustomerName = "Smith Farm",
            PrimaryContact = legacyContact, PrimaryPhone = legacyPhone, Contacts = contacts
        };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_PersistsContacts_AndGetComposesThemPrimaryFirst()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            Contact("Son", "(402) 555-2222"),
            Contact("Dad", "(402) 555-1111", isPrimary: true),
            Contact("Acme Insurance", email: "claims@acme.com"),
        }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.NotNull(pd);
        Assert.Equal(3, pd!.Contacts.Count);
        // Primary composes first regardless of submitted order.
        Assert.Equal("Dad", pd.Contacts[0].Name);
        Assert.True(pd.Contacts[0].IsPrimary);
        var insurance = Assert.Single(pd.Contacts, c => c.Name == "Acme Insurance");
        Assert.Equal("claims@acme.com", insurance.Email);
        Assert.Null(insurance.Phone);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_ReplacesPriorContactSet()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Contact("Dad", isPrimary: true), Contact("Son") }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args(new[] { Contact("Dad", "(402) 555-1111", isPrimary: true) }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        var only = Assert.Single(pd!.Contacts);
        Assert.Equal("Dad", only.Name);
        Assert.Equal("(402) 555-1111", only.Phone);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_DropsRowsWithBlankNames()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            Contact("Dad", isPrimary: true),
            Contact("   ", "(402) 555-9999"), // blank name → dropped even with details
        }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Single(pd!.Contacts);
        Assert.Equal("Dad", pd.Contacts[0].Name);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_EmptyList_ClearsContacts_AndNullsLegacyColumns()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Contact("Dad", "(402) 555-1111", isPrimary: true) }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args(Array.Empty<ProducerContactEntry>()), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Empty(pd!.Contacts);
        Assert.Null(pd.PrimaryContact);
        Assert.Null(pd.PrimaryPhone);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_NoPrimaryFlagged_PromotesTheFirstRow()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Contact("Dad"), Contact("Son") }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.True(pd!.Contacts[0].IsPrimary);
        Assert.Equal("Dad", pd.Contacts[0].Name);
        Assert.False(pd.Contacts[1].IsPrimary);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_TwoPrimariesFlagged_FirstWins()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            Contact("Dad", isPrimary: true),
            Contact("Son", isPrimary: true),
        }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Single(pd!.Contacts, c => c.IsPrimary);
        Assert.Equal("Dad", pd.Contacts.Single(c => c.IsPrimary).Name);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_DualWritesThePrimaryRow_IntoLegacyColumns()
    {
        using var db = NewContext();
        var repo = Repo(db);

        // Legacy fields on the request are ignored when contacts are provided.
        await repo.UpsertAsync(Args(new[]
        {
            Contact("Son", "(402) 555-2222"),
            Contact("Dad", "(402) 555-1111", isPrimary: true),
        }, legacyContact: "Stale Name", legacyPhone: "(999) 999-9999"), "tuser", CancellationToken.None);

        var row = await db.ProducerDetails.AsNoTracking().SingleAsync(p => p.CustomerId == 100);
        Assert.Equal("Dad", row.PrimaryContact);
        Assert.Equal("(402) 555-1111", row.PrimaryPhone);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_NullContacts_PreservesExistingRows_AndUsesLegacyFields()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Contact("Dad", "(402) 555-1111", isPrimary: true) }), "tuser", CancellationToken.None);
        // Old-shape payload: no contacts property at all. Rows must survive; legacy fields apply as sent.
        await repo.UpsertAsync(Args(null, legacyContact: "Dad", legacyPhone: "(402) 555-1111"), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        var kept = Assert.Single(pd!.Contacts);
        Assert.Equal("Dad", kept.Name);
        Assert.Equal("Dad", pd.PrimaryContact);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_CollapsesExactDuplicateRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            Contact("Dad", "(402) 555-1111", isPrimary: true),
            Contact("dad", "(402) 555-1111"),          // exact dupe (case-insensitive) → collapsed
            Contact("Dad", "(402) 555-2222"),          // same person, different number → kept
        }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Equal(2, pd!.Contacts.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_RemovesContactAndGrainChildRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(new ProducerDetailsUpsertArgs
        {
            CustomerId = 100, ScoularId = "S1", CustomerName = "Smith Farm",
            Contacts = new[] { Contact("Dad", isPrimary: true) },
            GrainOnFarm = new[] { new GrainOnFarmEntry { CommodityCode = "YC", BushelsOnHand = 10 } }
        }, "tuser", CancellationToken.None);

        await repo.DeleteAsync(100, "tester", CancellationToken.None);

        Assert.Empty(await db.ProducerContacts.AsNoTracking().ToListAsync());
        Assert.Empty(await db.ProducerGrainOnFarm.AsNoTracking().ToListAsync());
        Assert.Empty(await db.ProducerDetails.AsNoTracking().ToListAsync());
    }
}
