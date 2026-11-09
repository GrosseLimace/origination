// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;

namespace GrainOriginatorPortal.Api.Tests.Infrastructure;

/// <summary>
/// <see cref="ApplicationDbContext"/> applies every <c>IEntityTypeConfiguration</c> in the Infrastructure
/// assembly. The read-only contexts configure their entities inline instead, so a configuration class
/// written for one of them would quietly become part of the app's own model, and the next migration would
/// create its table in the app database. None of these tests opens a connection.
/// </summary>
public class ApplicationDbContextModelTests
{
    private const string NoServer = "Server=model-check.invalid;Database=ModelCheck;Integrated Security=true";

    private static HashSet<Type> EntityTypes(DbContext context) =>
        context.Model.GetEntityTypes()
            .Where(entity => !entity.HasSharedClrType && !entity.IsOwned())
            .Select(entity => entity.ClrType)
            .ToHashSet();

    [Fact]
    public void TheAppModel_SharesNoEntityWithTheReadOnlyContexts()
    {
        using var app = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlServer(NoServer).Options);
        using var ods = new OriginationDbContext(
            new DbContextOptionsBuilder<OriginationDbContext>().UseSqlServer(NoServer).Options);
        using var tradeUnits = new TradeUnitPreferencesDbContext(
            new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>().UseSqlServer(NoServer).Options);

        var shared = EntityTypes(app)
            .Intersect(EntityTypes(ods).Concat(EntityTypes(tradeUnits)))
            .Select(type => type.Name)
            .Order(StringComparer.Ordinal)
            .ToList();

        Assert.True(shared.Count == 0,
            "These entities belong to a read-only context but are also in ApplicationDbContext. Configure them "
            + "inline in that context's OnModelCreating, not with an IEntityTypeConfiguration class: "
            + string.Join(", ", shared));
    }
}
