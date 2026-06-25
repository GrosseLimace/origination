// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Exercises <see cref="ContractRepository.ApplyFreightAdjustments"/> — the pure merge that enriches
/// view-sourced pricing lines with FreightAdjustment from base.ContractPrice, keyed on
/// (SourceContractId, PriceSequence).
/// </summary>
public class ContractPricingFreightTests
{
    private static ContractPricingLine Line(string contractId, int? seq) =>
        new() { ContractId = contractId, PriceSequence = seq };

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyFreightAdjustments_MatchesByContractAndSequence()
    {
        var lines = new List<ContractPricingLine> { Line("C1", 1), Line("C1", 2) };

        ContractRepository.ApplyFreightAdjustments(lines, new (string?, int?, decimal?)[]
        {
            ("C1", 1, 0.05m),
            ("C1", 2, 0.10m),
        });

        Assert.Equal(0.05m, lines[0].FreightAdjustment);
        Assert.Equal(0.10m, lines[1].FreightAdjustment);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyFreightAdjustments_TrimsCharPaddedSourceContractId()
    {
        var lines = new List<ContractPricingLine> { Line("C1", 1) };

        // base.ContractPrice may be CHAR-padded; the line's ContractId is already trimmed.
        ContractRepository.ApplyFreightAdjustments(lines, new (string?, int?, decimal?)[]
        {
            ("C1     ", 1, 0.07m),
        });

        Assert.Equal(0.07m, lines[0].FreightAdjustment);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyFreightAdjustments_NoMatch_LeavesNull_AndNoCrossContractBleed()
    {
        var lines = new List<ContractPricingLine> { Line("C1", 1), Line("C2", 1) };

        ContractRepository.ApplyFreightAdjustments(lines, new (string?, int?, decimal?)[]
        {
            ("C1", 2, 0.05m),   // same contract, different sequence → no match
            ("C9", 1, 0.10m),   // different contract, same sequence → no match
        });

        Assert.Null(lines[0].FreightAdjustment);
        Assert.Null(lines[1].FreightAdjustment);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyFreightAdjustments_IgnoresNullFreightAndNullKeys()
    {
        var lines = new List<ContractPricingLine> { Line("C1", 1), Line("C1", null) };

        ContractRepository.ApplyFreightAdjustments(lines, new (string?, int?, decimal?)[]
        {
            ("C1", 1, null),      // null amount → not applied
            (null, 1, 0.05m),     // null id → skipped
        });

        Assert.Null(lines[0].FreightAdjustment);
        Assert.Null(lines[1].FreightAdjustment);
    }
}
