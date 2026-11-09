using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Models.Responses;
using GrainOriginatorPortal.Api.Platform.Exceptions;

namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.TDisc;

/// <summary>USDA's T-DISC tillage rating, checked against Excel at startup.</summary>
public interface ITDiscService
{
    /// <summary>The windows, implements and operation lookup the review's pass table is built from.</summary>
    TDiscOptionsResponse Options();

    /// <summary>Rates a field's passes. Throws a ValidationException when a pass isn't valid.</summary>
    TDiscResult Rate(IReadOnlyList<TDiscPassInput> passes);
}

/// <summary>
/// Loads the T-DISC pack once at startup and gates it (<see cref="TDiscCalculator.GateProblem"/>). A pack
/// that fails is logged ("T-DISC vX is switched off: …") and rates nothing: confirming a no-till or
/// reduced-till field then fails with that reason instead of using an unverified rating.
/// </summary>
public sealed class TDiscService : ITDiscService
{
    /// <summary>T-DISC isn't versioned by crop year: the newest USDA release is the one in use.</summary>
    public const string CurrentVersion = "1.1.1";

    private readonly TDiscPack? _pack;
    private readonly string? _problem;

    public TDiscService(ILogger<TDiscService> logger) : this(logger, () => TDiscPack.LoadEmbedded(CurrentVersion))
    {
    }

    /// <summary>Test seam: the pack comes from <paramref name="loadPack"/> instead of the assembly.</summary>
    internal TDiscService(ILogger<TDiscService> logger, Func<TDiscPack> loadPack)
    {
        try
        {
            _pack = loadPack();
            _problem = TDiscCalculator.GateProblem(_pack);
        }
        // Any fault in the pack (bad shape, duplicate name, missing list) switches the version off; it never stops the app.
        catch (Exception ex)
        {
            _problem = ex.Message;
        }

        if (_problem is not null)
            logger.LogError("T-DISC v{Version} is switched off: {Problem}", CurrentVersion, _problem);
        else
            logger.LogInformation("T-DISC v{Version} passed its {Count} test cases", CurrentVersion, _pack!.Golden.Cases.Length);
    }

    public TDiscOptionsResponse Options()
    {
        var pack = Usable();
        return new TDiscOptionsResponse
        {
            Version = pack.Version,
            Label = pack.Label,
            MaxPasses = pack.Rules.MaxPasses,
            IndexDepthCm = pack.Rules.IndexDepthCm,
            Designations = pack.Rules.Designations.Select(d => new TDiscLimitResponse { Max = d.Max, Designation = d.Designation }).ToList(),
            Windows = pack.Windows.Select(w => new TDiscWindowResponse { Key = w.Key, Label = w.Label, Implements = w.Implements }).ToList(),
            Implements = pack.Implements.Values
                .Select(i => new TDiscImplementResponse { Name = i.Name, MixingEfficiency = i.MixingEfficiency, DepthCm = i.DepthCm })
                .ToList(),
            Operations = pack.Operations.Select(o => new TDiscOperationResponse { Name = o.Name, Implements = o.Implements }).ToList(),
        };
    }

    public TDiscResult Rate(IReadOnlyList<TDiscPassInput> passes)
    {
        var pack = Usable();
        if (TDiscCalculator.Problem(pack, passes) is { } problem) throw new ValidationException("tDiscPasses", problem);
        return TDiscCalculator.Rate(pack, passes);
    }

    private TDiscPack Usable() =>
        _problem is null ? _pack!
            : throw new InfrastructureException($"USDA T-DISC is switched off: {_problem}", "TDISC_UNAVAILABLE");
}
