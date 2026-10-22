// Microsoft namespaces
using Microsoft.Extensions.Configuration;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>The mass-deactivation guard: a pure rule over counts, shared by both sync sources.</summary>
public class CustomerSyncGuardTests
{
    private static readonly CustomerSyncGuardLimits Defaults = new(5, 500);

    [Fact]
    public void Evaluate_EmptySourceWithActiveRows_Trips()
    {
        var verdict = CustomerSyncGuard.Evaluate(0, 100, 0, 300, 0, Defaults);

        Assert.True(verdict.Tripped);
        Assert.StartsWith("source returned no rows", verdict.Reason);
    }

    [Fact]
    public void Evaluate_EmptySourceOnEmptyApp_DoesNotTrip()
    {
        var verdict = CustomerSyncGuard.Evaluate(0, 0, 0, 0, 0, Defaults);

        Assert.False(verdict.Tripped);
    }

    [Fact]
    public void Evaluate_CustomerCountAboveAbsoluteLimit_Trips()
    {
        var verdict = CustomerSyncGuard.Evaluate(99_000, 100_000, 501, 0, 0, new CustomerSyncGuardLimits(100, 500));

        Assert.True(verdict.Tripped);
        Assert.Contains("customers", verdict.Reason);
    }

    [Fact]
    public void Evaluate_CustomerPercentAboveLimit_Trips()
    {
        var verdict = CustomerSyncGuard.Evaluate(900, 1000, 51, 0, 0, new CustomerSyncGuardLimits(5, 500));

        Assert.True(verdict.Tripped);
    }

    [Fact]
    public void Evaluate_LinkPercentAboveLimit_Trips()
    {
        var verdict = CustomerSyncGuard.Evaluate(900, 1000, 0, 2000, 101, new CustomerSyncGuardLimits(5, 500));

        Assert.True(verdict.Tripped);
        Assert.Contains("links", verdict.Reason);
    }

    [Fact]
    public void Evaluate_WithinBothLimits_DoesNotTrip()
    {
        var verdict = CustomerSyncGuard.Evaluate(950, 1000, 50, 2000, 100, new CustomerSyncGuardLimits(5, 500));

        Assert.False(verdict.Tripped);
        Assert.Null(verdict.Reason);
    }

    [Fact]
    public void FromConfiguration_ClampsAndDefaults()
    {
        var empty = new ConfigurationBuilder().Build();
        var wild = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CustomerSync:MaxDeactivationPercent"] = "250",
            ["CustomerSync:MaxDeactivationCount"] = "-3",
        }).Build();

        Assert.Equal(new CustomerSyncGuardLimits(5, 500), CustomerSyncGuardLimits.FromConfiguration(empty));
        Assert.Equal(new CustomerSyncGuardLimits(100, 0), CustomerSyncGuardLimits.FromConfiguration(wild));
    }
}
