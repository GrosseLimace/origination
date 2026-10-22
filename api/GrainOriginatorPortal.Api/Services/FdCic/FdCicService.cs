using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Services.FdCic;

/// <summary>
/// Loads the configured FD-CIC packs once at startup and gates each one (see <see cref="FdCicVersionGate"/>).
/// A version that fails stays loaded for <see cref="Versions"/> to report, but scores nothing: requests
/// for its years fail with a logged error rather than returning an unverified number.
/// </summary>
public sealed class FdCicService : IFdCicService
{
    private const string Unit = "g CO2e/bu";

    private readonly FdCicSettings _settings;
    private readonly Dictionary<string, VersionState> _versions;

    public FdCicService(FdCicSettings settings, IEnumerable<IFdCicMethod> methods, ILogger<FdCicService> logger)
        : this(settings, methods, logger, version => FdCicPack.LoadEmbedded(version))
    {
    }

    /// <summary>Test seam: packs come from <paramref name="loadPack"/> instead of the assembly.</summary>
    internal FdCicService(FdCicSettings settings, IEnumerable<IFdCicMethod> methods, ILogger<FdCicService> logger, Func<string, FdCicPack> loadPack)
    {
        _settings = settings;
        var methodList = methods.ToList();
        _versions = new Dictionary<string, VersionState>(StringComparer.Ordinal);

        foreach (var version in settings.VersionByYear.Values.Distinct(StringComparer.Ordinal))
        {
            VersionState state;
            try
            {
                var pack = loadPack(version);
                var (method, problem) = FdCicVersionGate.Check(pack, methodList);
                state = new VersionState(version, pack, method, problem);
            }
            catch (Exception ex) when (ex is InvalidDataException or System.Text.Json.JsonException)
            {
                state = new VersionState(version, null, null, ex.Message);
            }

            if (state.Problem is not null)
                logger.LogError("FD-CIC v{Version} is switched off: {Problem}", version, state.Problem);
            else
                logger.LogInformation("FD-CIC v{Version} passed its {Count} test cases", version, state.Pack!.Golden.Cases.Length);
            _versions[version] = state;
        }
    }

    public IReadOnlyList<FdCicVersionResponse> Versions() =>
        _versions.Values
            .OrderBy(v => v.Version, StringComparer.Ordinal)
            .Select(v => new FdCicVersionResponse
            {
                Version = v.Version,
                Label = v.Pack?.Label ?? $"USDA FD-CIC v{v.Version}",
                Years = _settings.VersionByYear.Where(y => y.Value == v.Version).Select(y => y.Key).Order().ToList(),
                Available = v.Problem is null,
                Problem = v.Problem,
                SourceFile = v.Pack?.Manifest.Source.File,
                SourceSha256 = v.Pack?.Manifest.Source.Sha256,
                WorkbookModified = v.Pack?.Manifest.Source.WorkbookModified,
                FormulaFingerprint = v.Pack?.Manifest.FormulaFingerprint,
                ConfirmedInExcelOn = v.Pack?.Golden.ConfirmedInExcel?.On,
            })
            .ToList();

    public FdCicOptionsResponse Options(int year)
    {
        var (pack, _) = Usable(year);
        return new FdCicOptionsResponse
        {
            Version = pack.Version,
            Label = pack.Label,
            Crops = pack.Options.Crops,
            CoverCrops = pack.Options.CoverCrops,
            Tillage = pack.Options.Tillage,
            ManureTypes = pack.Options.ManureTypes
                .Select(m => new FdCicManureTypeResponse { Label = m.Label, Unit = m.Unit, LikelyMaxNPerUnit = m.LikelyMaxNPerUnit })
                .ToList(),
            States = pack.Counties.Select(c => c.State).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList(),
            MaxManureEntries = FdCicInputRules.MaxManureEntries,
        };
    }

    public IReadOnlyList<string> Counties(int year, string state)
    {
        var (pack, _) = Usable(year);
        return pack.Counties
            .Where(c => string.Equals(c.State, state, StringComparison.OrdinalIgnoreCase))
            .Select(c => c.County)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public FdCicScoreResponse Score(int year, FdCicInput input)
    {
        var (pack, method) = Usable(year);
        var errors = FdCicInputRules.Validate(pack, input);
        if (errors.Count > 0) throw new ValidationException(errors);

        var result = method.Calculate(pack, input);
        var c = result.Components;
        return new FdCicScoreResponse
        {
            Version = pack.Version,
            Label = pack.Label,
            SourceSha256 = pack.Manifest.Source.Sha256,
            FormulaFingerprint = pack.Manifest.FormulaFingerprint,
            Projected = input.ActualYield is null,
            Scorable = result.Scorable,
            UnscorableReason = result.UnscorableReason,
            Mlra = result.Mlra,
            YieldForCi = result.YieldForCi,
            Components = c is null ? null : new FdCicComponentsResponse
            {
                NFertilizer = c.NFertilizer,
                SoilCarbon = c.SoilCarbon,
                DirectN2o = c.DirectN2o,
                IndirectN2o = c.IndirectN2o,
                OnFarmEnergy = c.OnFarmEnergy,
                OtherChemicals = c.OtherChemicals,
                UreaLime = c.UreaLime,
            },
            Ci = result.Ci,
            NationalAverage = result.NationalAverage,
            ChangeFraction = result.ChangeFraction,
            Unit = Unit,
        };
    }

    private (FdCicPack Pack, IFdCicMethod Method) Usable(int year)
    {
        if (!_settings.VersionByYear.TryGetValue(year, out var version))
            throw new BusinessException($"No USDA FD-CIC version is set for {year}.", "FD_CIC_NO_VERSION_FOR_YEAR",
                StatusCodes.Status422UnprocessableEntity);
        var state = _versions[version];
        if (state.Problem is not null)
            throw new InfrastructureException($"FD-CIC v{version} (year {year}) is switched off: {state.Problem}", "FD_CIC_VERSION_UNAVAILABLE");
        return (state.Pack!, state.Method!);
    }

    private sealed record VersionState(string Version, FdCicPack? Pack, IFdCicMethod? Method, string? Problem);
}
