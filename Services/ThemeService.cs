using Microsoft.JSInterop;

namespace GrainOriginatorPortal.Services;

/// <summary>
/// Manages dark/light theme preferences for the application.
/// </summary>
/// <remarks>
/// This service persists theme preferences to localStorage via JavaScript interop
/// and broadcasts theme changes to subscribed components.
/// </remarks>
public class ThemeService : IAsyncDisposable
{
    private readonly IJSRuntime _jsRuntime;
    private bool _isDarkMode;
    private bool _isInitialized;

    public bool IsDarkMode => _isDarkMode;

    public event Action? OnThemeChanged;

    public ThemeService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    public async Task InitializeAsync()
    {
        if (_isInitialized) return;

        try
        {
            var theme = await _jsRuntime.InvokeAsync<string>("themeManager.getTheme");
            _isDarkMode = theme == "dark";
            _isInitialized = true;
        }
        catch
        {
            // JS interop not available yet (prerendering)
            _isDarkMode = false;
        }
    }

    public async Task ToggleThemeAsync()
    {
        try
        {
            var newTheme = await _jsRuntime.InvokeAsync<string>("themeManager.toggleTheme");
            _isDarkMode = newTheme == "dark";
            OnThemeChanged?.Invoke();
        }
        catch
        {
            // Fallback if JS not available
            _isDarkMode = !_isDarkMode;
            OnThemeChanged?.Invoke();
        }
    }

    public async Task SetDarkModeAsync(bool isDark)
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("themeManager.setTheme", isDark ? "dark" : "light");
            _isDarkMode = isDark;
            OnThemeChanged?.Invoke();
        }
        catch
        {
            _isDarkMode = isDark;
            OnThemeChanged?.Invoke();
        }
    }

    // Keep synchronous methods for backward compatibility
    public void ToggleTheme()
    {
        _ = ToggleThemeAsync();
    }

    public void SetDarkMode(bool isDark)
    {
        _ = SetDarkModeAsync(isDark);
    }

    public async ValueTask DisposeAsync()
    {
        // Cleanup if needed
    }
}
