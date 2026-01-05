using GrainOriginatorPortal.Models;

namespace GrainOriginatorPortal.Services;

public class AppState
{
    private Customer? _selectedCustomer;
    private string? _selectedFarmId;
    private string _currentView = "customers";

    public Customer? SelectedCustomer
    {
        get => _selectedCustomer;
        set
        {
            _selectedCustomer = value;
            // Set default farm when customer is selected
            if (value != null && value.FarmIds.Count > 0)
            {
                _selectedFarmId = value.FarmIds[0];
            }
            else
            {
                _selectedFarmId = null;
            }
            NotifyStateChanged();
        }
    }

    public string? SelectedFarmId
    {
        get => _selectedFarmId;
        set
        {
            _selectedFarmId = value;
            NotifyStateChanged();
        }
    }

    public string CurrentView
    {
        get => _currentView;
        set
        {
            _currentView = value;
            NotifyStateChanged();
        }
    }

    public event Action? OnChange;

    private void NotifyStateChanged() => OnChange?.Invoke();

    public void ClearSelection()
    {
        _selectedCustomer = null;
        _selectedFarmId = null;
        NotifyStateChanged();
    }
}
