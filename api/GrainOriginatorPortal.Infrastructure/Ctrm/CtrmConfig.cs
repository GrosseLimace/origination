using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads the <c>Ctrm:*</c> tuning knobs out of configuration.
/// </summary>
/// <remarks>
/// Every CTRM knob is read fresh at the point of use rather than bound once at startup, so an App Service
/// configuration change takes effect without a restart. That means a great many small parse calls, and the
/// parsing had been copied into six classes independently: the two readers, the ticket repository, the
/// timeout-retry and throttle helpers, and the keep-warm service.
///
/// Copies drift, and these had. <c>CtrmKeepWarmService</c> parsed integers without
/// <see cref="CultureInfo.InvariantCulture"/>, so it read the same appsetting differently from everything
/// else on a machine whose locale formats numbers differently. <c>CtrmTicketRepository</c>'s boolean reader
/// took no fallback at all and silently meant "false when unset", which reads like an oversight at the call
/// site rather than a decision. Both are resolved by there being one implementation.
///
/// A malformed value falls back rather than throwing, deliberately: a typo in one knob should degrade that
/// one behaviour to its default, not stop the application from starting.
///
/// These use the configuration indexer rather than <c>GetValue&lt;T&gt;</c> because that extension lives in
/// Microsoft.Extensions.Configuration.Binder, which this project does not reference.
/// </remarks>
public static class CtrmConfig
{
    /// <summary>Reads an integer knob, falling back when unset or unparseable.</summary>
    public static int ReadInt(IConfiguration configuration, string key, int fallback) =>
        int.TryParse(configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;

    /// <summary>Reads a boolean knob, falling back when unset or unparseable.</summary>
    /// <remarks>
    /// <see cref="bool.TryParse(string?, out bool)"/> takes no culture: it matches "true"/"false"
    /// case-insensitively and nothing else, which is what appsettings carry.
    /// </remarks>
    public static bool ReadBool(IConfiguration configuration, string key, bool fallback) =>
        bool.TryParse(configuration[key]?.Trim(), out var parsed) ? parsed : fallback;
}
