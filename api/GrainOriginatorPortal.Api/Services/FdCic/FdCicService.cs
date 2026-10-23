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
            MaxManureEntries = FdCicInputRules.MaxManureEntries,
        };
    }

    public IReadOnlyList<string> States() =>
        LocationPack().Counties.Select(c => c.State).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();

    public IReadOnlyList<string> Counties(string state) =>
        LocationPack().Counties
            .Where(c => string.Equals(c.State, state, StringComparison.OrdinalIgnoreCase))
            .Select(c => c.County)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>A field's location is entered once for every year, so the lists come from the newest usable version.</summary>
    private FdCicPack LocationPack() =>
        _versions.Values
            .Where(v => v.Problem is null)
            .OrderByDescending(v => _settings.VersionByYear.Where(y => y.Value == v.Version).Max(y => y.Key))
            .Select(v => v.Pack)
            .FirstOrDefault()
        ?? throw new InfrastructureException("No FD-CIC version passed its test cases, so there is no county list.", "FD_CIC_VERSION_UNAVAILABLE");

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
            Breakdown = c is null ? [] : method.Breakdown(pack, input, c).Select(p => new FdCicComponentPartResponse
            {
                Key = p.Key, Label = p.Label, Total = p.Total, Fixed = p.Fixed, FixedLabel = p.FixedLabel, Drivers = p.Drivers,
            }).ToList(),
            Ci = result.Ci,
            NationalAverage = result.NationalAverage,
            ChangeFraction = result.ChangeFraction,
            Effects = result.Scorable ? Effects(pack, method, input, result) : [],
            Unit = Unit,
        };
    }

    /// <summary>
    /// What each choice is worth: the score with the choice minus the score with the workbook's default
    /// in its place, everything else equal. Not a USDA output; it explains the USDA score in plain terms.
    /// </summary>
    internal static IReadOnlyList<FdCicEffectResponse> Effects(FdCicPack pack, IFdCicMethod method, FdCicInput input, FdCicResult result)
    {
        const string defaultTillage = "None of the above", defaultCover = "No cover crop";
        var effects = new List<FdCicEffectResponse>();
        void Compare(string label, FdCicInput without)
        {
            var other = method.Calculate(pack, without);
            if (!other.Scorable) return;
            double delta = result.Ci!.Value - other.Ci!.Value;
            if (Math.Abs(delta) >= 1) effects.Add(new FdCicEffectResponse { Label = label, Delta = delta });
        }

        if (input.Tillage != defaultTillage && pack.Options.Tillage.Contains(defaultTillage))
            Compare(input.Tillage, input with { Tillage = defaultTillage });
        if (input.CoverCrop != defaultCover && pack.Options.CoverCrops.Contains(defaultCover))
            Compare(input.CoverCrop, input with { CoverCrop = defaultCover });
        if (input.NiFraction > 0)
            Compare("Nitrification inhibitor", input with { NiFraction = 0 });
        if (input.Manure.Count > 0)
            Compare("Manure", input with { Manure = [] });
        // Against the national N use per bushel behind USDA's national average, at this field's yield.
        var crop = pack.Constants.Crop(input.Crop)!;
        Compare("Nitrogen rate vs. national", input with { SyntheticN = crop.DefaultNui * result.YieldForCi, ActualYield = result.YieldForCi });
        return effects.OrderBy(e => e.Delta).ToList();
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
