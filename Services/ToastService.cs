namespace GrainOriginatorPortal.Services;

/// <summary>
/// Toast notification display variants.
/// </summary>
public enum ToastVariant
{
    /// <summary>Informational notification (blue).</summary>
    Info,
    /// <summary>Success notification (green).</summary>
    Success,
    /// <summary>Warning notification (yellow/orange).</summary>
    Warning,
    /// <summary>Error notification (red).</summary>
    Error
}

/// <summary>
/// Represents a toast notification item.
/// </summary>
public class ToastItem
{
    /// <summary>Unique identifier for the toast.</summary>
    public string Id { get; set; } = Guid.NewGuid().ToString();
    /// <summary>Optional title displayed in bold.</summary>
    public string? Title { get; set; }
    /// <summary>Main message content.</summary>
    public string Message { get; set; } = "";
    /// <summary>Visual variant/style of the toast.</summary>
    public ToastVariant Variant { get; set; } = ToastVariant.Info;
    /// <summary>When the toast was created.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

/// <summary>
/// Service for displaying toast notifications throughout the application.
/// </summary>
/// <remarks>
/// Toasts are automatically dismissed after a configurable duration.
/// Components should subscribe to OnChange to render updated toast list.
/// </remarks>
public class ToastService : IDisposable
{
    private readonly List<ToastItem> _toasts = new();
    private readonly Dictionary<string, Timer> _timers = new();

    public IReadOnlyList<ToastItem> Toasts => _toasts.AsReadOnly();

    public event Action? OnChange;

    public void Show(string message, string? title = null, ToastVariant variant = ToastVariant.Info, int durationMs = 5000)
    {
        var toast = new ToastItem
        {
            Title = title,
            Message = message,
            Variant = variant
        };

        _toasts.Add(toast);
        OnChange?.Invoke();

        // Auto-remove after duration
        var timer = new Timer(_ =>
        {
            Remove(toast.Id);
        }, null, durationMs, Timeout.Infinite);

        _timers[toast.Id] = timer;
    }

    public void Success(string message, string? title = null)
        => Show(message, title ?? "Success", ToastVariant.Success);

    public void Error(string message, string? title = null)
        => Show(message, title ?? "Error", ToastVariant.Error);

    public void Warning(string message, string? title = null)
        => Show(message, title ?? "Warning", ToastVariant.Warning);

    public void Info(string message, string? title = null)
        => Show(message, title ?? "Info", ToastVariant.Info);

    public void Remove(string id)
    {
        var toast = _toasts.FirstOrDefault(t => t.Id == id);
        if (toast != null)
        {
            _toasts.Remove(toast);

            if (_timers.TryGetValue(id, out var timer))
            {
                timer.Dispose();
                _timers.Remove(id);
            }

            OnChange?.Invoke();
        }
    }

    public void Dispose()
    {
        foreach (var timer in _timers.Values)
        {
            timer.Dispose();
        }
        _timers.Clear();
    }
}
