namespace GrainOriginatorPortal.Api.Services.FdCic;

/// <summary>
/// Which USDA FD-CIC version scores each crop year (<c>FdCic:VersionByYear</c>, e.g. <c>"2026": "1.2"</c>).
/// Moving a year to a new USDA version is a configuration change; the version must also pass its
/// test cases (<see cref="FdCicVersionGate"/>) before it scores anything.
/// </summary>
public sealed class FdCicSettings
{
    public const string SectionKey = "FdCic:VersionByYear";

    public IReadOnlyDictionary<int, string> VersionByYear { get; }

    public FdCicSettings(IReadOnlyDictionary<int, string> versionByYear) => VersionByYear = versionByYear;

    public static FdCicSettings From(IConfiguration config)
    {
        var byYear = new Dictionary<int, string>();
        foreach (var entry in config.GetSection(SectionKey).GetChildren())
        {
            // A typo here would quietly leave a year unscored, so a bad entry stops startup instead.
            if (!int.TryParse(entry.Key, out int year) || year is < 2020 or > 2100 || string.IsNullOrWhiteSpace(entry.Value))
                throw new InvalidOperationException($"{SectionKey} entry \"{entry.Key}\": \"{entry.Value}\" must map a year to a version, e.g. \"2026\": \"1.2\".");
            byYear[year] = entry.Value.Trim();
        }
        return new FdCicSettings(byYear);
    }
}
