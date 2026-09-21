using System.Threading;
using System.Threading.Tasks;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Non-person mention ids reach an ODATA $filter in the Instant Share Note and Daily Recap
/// workflows, interpolated unquoted ("TradeUnitCode eq @{item()?['id']}"). The SQL connector offers
/// no parameterisation there, so the workflows cannot defend themselves — the id has to be pinned to
/// a safe shape at save time. Model validation only bounds length, so these tests are the guard.
///
/// The attack these prevent: an id that widens the filter (e.g. appending "or IsActive eq 1") makes
/// the workflow mail the note body to everyone the broadened query returns, from a privileged shared
/// mailbox.
/// </summary>
public class NoteMentionIdValidationTests
{
    [Theory]
    [InlineData("3078")]
    [InlineData("4056")]
    [InlineData("TU-01")]
    [InlineData("tu_west.2")]
    public async Task Accepts_a_normal_trade_unit_code(string id)
    {
        var (svc, captured) = Build();
        await svc.CreateAsync(1, "note", [Mention(NoteMention.TradeUnitType, id)], CancellationToken.None);
        Assert.Contains(id, captured());
    }

    [Theory]
    [InlineData("3078' or IsActive eq 1 or '1' eq '1")]   // widen the filter → mail everyone
    [InlineData("3078 or IsActive eq 1")]
    [InlineData("3078'")]                                  // stray quote
    [InlineData("3078 or 1 eq 1")]                         // inner whitespace + operator
    [InlineData("")]
    [InlineData("012345678901234567890")]                  // 21 chars, past nvarchar(20)
    public async Task Rejects_a_trade_unit_id_that_could_alter_the_filter(string id)
    {
        var (svc, _) = Build();
        await Assert.ThrowsAsync<ValidationException>(() =>
            svc.CreateAsync(1, "note", [Mention(NoteMention.TradeUnitType, id)], CancellationToken.None));
    }

    [Theory]
    [InlineData(NoteMention.TradeUnitGroupType, "7")]
    [InlineData(NoteMention.TradeUnitGroupType, "1234567890")]
    public async Task Accepts_a_numeric_group_id(string type, string id)
    {
        var (svc, captured) = Build();
        await svc.CreateAsync(1, "note", [Mention(type, id)], CancellationToken.None);
        Assert.Contains(id, captured());
    }

    [Theory]
    [InlineData("7 or GroupId eq 8")]
    [InlineData("7'")]
    [InlineData("abc")]
    [InlineData("-1")]
    public async Task Rejects_a_non_numeric_group_id(string id)
    {
        var (svc, _) = Build();
        await Assert.ThrowsAsync<ValidationException>(() =>
            svc.CreateAsync(1, "note", [Mention(NoteMention.TradeUnitGroupType, id)], CancellationToken.None));
    }

    /// <summary>Surrounding whitespace is tolerated, but the id is STORED trimmed — what the
    /// workflow interpolates into its filter must be the string that was validated, not a variant
    /// of it.</summary>
    [Fact]
    public async Task Stores_the_trimmed_id_that_was_validated()
    {
        var (svc, captured) = Build();
        await svc.CreateAsync(1, "note", [Mention(NoteMention.TradeUnitType, "  3078  ")], CancellationToken.None);
        Assert.Contains("\"3078\"", captured());
        Assert.DoesNotContain("  3078", captured());
    }

    /// <summary>Person ids keep their own, stricter rule — this must not have loosened it.</summary>
    [Fact]
    public async Task Still_rejects_a_foreign_domain_person_mention()
    {
        var (svc, _) = Build();
        await Assert.ThrowsAsync<ValidationException>(() =>
            svc.CreateAsync(1, "note", [Mention(NoteMention.PersonType, "attacker@evil.com")], CancellationToken.None));
    }

    private static NoteMention Mention(string type, string id) =>
        new() { Type = type, Id = id, Name = "display" };

    /// <summary>Returns the service plus an accessor for the Mentions JSON handed to the repository.</summary>
    private static (NoteService Svc, System.Func<string> CapturedJson) Build()
    {
        var repo = new Mock<INoteRepository>();
        string json = string.Empty;
        repo.Setup(r => r.AddAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<long, string, string?, string?, string, CancellationToken>((_, _, _, m, _, _) => json = m ?? string.Empty)
            .ReturnsAsync(new Note { Id = 1, CustomerId = 1, CreatedBy = "CEgr", Description = "note" });

        var customerRepo = new Mock<ICustomerRepository>();
        var names = new Mock<IDisplayNameLookupRepository>();
        names.Setup(n => n.ResolveAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        var ctx = new Mock<IRequestContextService>();
        ctx.Setup(c => c.GetCurrentUser()).Returns("CEgr");
        var groups = new Mock<IDailyRecapGroupService>();
        groups.Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync([]);
        // Every id asked about is an active user: these tests are about id SHAPE, not identity.
        var entitlements = new Mock<IEntitlementsRepository>();
        entitlements.Setup(e => e.GetActiveUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyCollection<string> ids, CancellationToken _) => ids.ToHashSet(System.StringComparer.OrdinalIgnoreCase));

        var svc = new NoteService(repo.Object, customerRepo.Object, names.Object, ctx.Object,
            groups.Object, MentionTestDoubles.TeamsChannelStub(), entitlements.Object, new Mock<ILogger<NoteService>>().Object);
        return (svc, () => json);
    }
}
