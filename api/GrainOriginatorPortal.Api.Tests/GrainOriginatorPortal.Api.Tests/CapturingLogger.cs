// Microsoft namespaces
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Records every log call with its structured fields, so a test can assert what an <c>AUDIT_</c> line
/// actually carries. The accepted-risks register leans on those lines as a compensating control, and
/// every such claim in it has been wrong at least once (see AR-01, M-043): check the fields, not
/// just that something was logged.
/// </summary>
public sealed class CapturingLogger<T> : ILogger<T>
{
    public sealed record Entry(LogLevel Level, string Message, IReadOnlyDictionary<string, object?> Fields);

    public List<Entry> Entries { get; } = [];

    /// <summary>The single entry whose <c>ErrorCode</c> field is <paramref name="code"/>.</summary>
    public Entry Audit(string code) =>
        Assert.Single(Entries, e => e.Fields.TryGetValue("ErrorCode", out var c) && Equals(c, code));

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        var fields = state is IEnumerable<KeyValuePair<string, object?>> pairs
            ? pairs.Where(p => p.Key != "{OriginalFormat}").ToDictionary(p => p.Key, p => p.Value)
            : new Dictionary<string, object?>();
        Entries.Add(new Entry(logLevel, formatter(state, exception), fields));
    }
}
