// Project namespaces
using GrainOriginatorPortal.Api.Middleware;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// Request-supplied text that reaches a log line or log scope must not be able to forge a second line
/// (CWE-117; QA scan 2026-09-30). These pin what the sanitiser changes and, just as important, what it
/// leaves alone.
/// </summary>
public class LogSanitizerTests
{
    [Fact]
    public void ControlCharactersBecomeSpaces_SoAPathCannotStartANewLogLine()
    {
        // ASP.NET Core hands middleware the URL-decoded path, so %0D%0A arrives as a real CR LF.
        var forged = "/api/x\r\n2026-01-01 WARN Access denied UserId=admin\tOperation=Approve\u001b[0m";

        var clean = LogSanitizer.Clean(forged);

        Assert.NotNull(clean);
        Assert.DoesNotContain('\r', clean);
        Assert.DoesNotContain('\n', clean);
        Assert.DoesNotContain('\t', clean);
        Assert.DoesNotContain('\u001b', clean);
        Assert.Equal("/api/x  2026-01-01 WARN Access denied UserId=admin Operation=Approve [0m", clean);
    }

    [Fact]
    public void OverlongValuesAreCut_ToKeepOneRequestFromFloodingTheLog()
    {
        var clean = LogSanitizer.Clean(new string('a', 5000));

        Assert.Equal(LogSanitizer.DefaultMaxLength, clean!.Length);
    }

    [Fact]
    public void AnOrdinaryPathIsReturnedUnchanged_AndAsTheSameInstance()
    {
        // Real routes must stay byte-for-byte searchable, and the common case should not allocate.
        const string path = "GET /api/customers/12345/trade-units?includeActivity=false";

        var clean = LogSanitizer.Clean(path);

        Assert.Same(path, clean);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void NullAndEmptyPassThrough(string? value)
    {
        Assert.Equal(value, LogSanitizer.Clean(value));
    }

    [Fact]
    public void AUnicodeNameSurvives_OnlyControlCharactersAreTouched()
    {
        // A token claim can carry any text; accented names are legitimate and must not be mangled.
        const string name = "José Núñez-Ålund";

        Assert.Equal(name, LogSanitizer.Clean(name));
    }
}
