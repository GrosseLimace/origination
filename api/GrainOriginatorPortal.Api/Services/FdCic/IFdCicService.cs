namespace GrainOriginatorPortal.Api.Services.FdCic;

/// <summary>
/// The 45Z feedstock carbon-intensity calculator (USDA FD-CIC), versioned by crop year.
/// </summary>
public interface IFdCicService
{
    /// <summary>Every configured or embedded version, with whether it passed its test cases.</summary>
    IReadOnlyList<FdCicVersionResponse> Versions();

    /// <summary>The input choices for the year's version. Throws when no usable version is set for the year.</summary>
    FdCicOptionsResponse Options(int year);

    /// <summary>The county names the year's version knows for a state, sorted.</summary>
    IReadOnlyList<string> Counties(int year, string state);

    /// <summary>Scores one field. Throws <see cref="Exceptions.ValidationException"/> for invalid input;
    /// a crop and place USDA has no data for comes back with <c>Scorable = false</c> and a reason.</summary>
    FdCicScoreResponse Score(int year, FdCicInput input);
}
