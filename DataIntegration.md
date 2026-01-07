# Data Integration Guide

## Overview

This document outlines how to connect the Grain Originator Portal to real data sources, replacing the current mock data implementation.

## Current Architecture

The application uses a service-based architecture with dependency injection:

```
UI Components → IDataService → MockDataService (current)
                            → EFDataService (database)
                            → ApiDataService (REST API)
```

All data access goes through the `IDataService` interface, making it easy to swap implementations.

## Option 1: Entity Framework Core (Recommended for SQL Server)

### Step 1: Install NuGet Packages

```bash
dotnet add package Microsoft.EntityFrameworkCore.SqlServer
dotnet add package Microsoft.EntityFrameworkCore.Tools
dotnet add package Microsoft.EntityFrameworkCore.Design
```

### Step 2: Create DbContext

Create a new file `Data/ApplicationDbContext.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Models;

namespace GrainOriginatorPortal.Data;

public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Farm> Farms => Set<Farm>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<PlantingIntention> PlantingIntentions => Set<PlantingIntention>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<StoredGrain> StoredGrain => Set<StoredGrain>();
    public DbSet<SavedList> SavedLists => Set<SavedList>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Configure Customer entity
        modelBuilder.Entity<Customer>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Name).IsRequired().HasMaxLength(200);
            entity.Property(c => c.Email).HasMaxLength(200);
            entity.Property(c => c.Phone).HasMaxLength(50);
            // Store FarmIds as JSON (or create junction table)
            entity.Ignore(c => c.FarmIds);
            entity.Ignore(c => c.Coordinates);
        });

        // Configure Contract entity
        modelBuilder.Entity<Contract>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Price).HasPrecision(18, 4);
            entity.HasIndex(c => c.CustomerId);
            entity.HasIndex(c => c.FarmId);
        });

        // Configure other entities similarly...
    }
}
```

### Step 3: Create EF-based Data Service

Create `Services/EFDataService.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Data;
using GrainOriginatorPortal.Models;

namespace GrainOriginatorPortal.Services;

public class EFDataService : IDataService
{
    private readonly ApplicationDbContext _context;

    public EFDataService(ApplicationDbContext context)
    {
        _context = context;
    }

    public List<Customer> GetCustomers()
    {
        return _context.Customers.ToList();
    }

    public Customer? GetCustomerById(string id)
    {
        return _context.Customers.Find(id);
    }

    public void UpdateCustomer(string customerId, string location, string phone, string email, List<string> farmIds)
    {
        var customer = _context.Customers.Find(customerId);
        if (customer != null)
        {
            customer.Location = location;
            customer.Phone = phone;
            customer.Email = email;
            customer.FarmIds = farmIds;
            _context.SaveChanges();
        }
    }

    // Implement other methods similarly...
}
```

### Step 4: Configure in Program.cs

```csharp
// Add connection string to appsettings.json first
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// Replace MockDataService with EFDataService
builder.Services.AddScoped<IDataService, EFDataService>();
```

### Step 5: Add Connection String

In `appsettings.json`:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost;Database=GrainOriginatorPortal;Trusted_Connection=True;TrustServerCertificate=True;"
  }
}
```

### Step 6: Create and Apply Migrations

```bash
dotnet ef migrations add InitialCreate
dotnet ef database update
```

---

## Option 2: REST API Integration

If your data comes from an external API, implement an HTTP-based service.

### Step 1: Create API Data Service

Create `Services/ApiDataService.cs`:

```csharp
using System.Net.Http.Json;
using GrainOriginatorPortal.Models;

namespace GrainOriginatorPortal.Services;

public class ApiDataService : IDataService
{
    private readonly HttpClient _httpClient;

    public ApiDataService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public List<Customer> GetCustomers()
    {
        // Note: For production, use async methods
        var response = _httpClient.GetAsync("/api/customers").Result;
        response.EnsureSuccessStatusCode();
        return response.Content.ReadFromJsonAsync<List<Customer>>().Result ?? new();
    }

    public Customer? GetCustomerById(string id)
    {
        var response = _httpClient.GetAsync($"/api/customers/{id}").Result;
        if (!response.IsSuccessStatusCode) return null;
        return response.Content.ReadFromJsonAsync<Customer>().Result;
    }

    public void UpdateCustomer(string customerId, string location, string phone, string email, List<string> farmIds)
    {
        var payload = new { location, phone, email, farmIds };
        var response = _httpClient.PutAsJsonAsync($"/api/customers/{customerId}", payload).Result;
        response.EnsureSuccessStatusCode();
    }

    // Implement other methods...
}
```

### Step 2: Configure HttpClient in Program.cs

```csharp
// Add to appsettings.json: "ApiBaseUrl": "https://your-api.com"
builder.Services.AddHttpClient<IDataService, ApiDataService>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["ApiBaseUrl"]!);
    // Add authentication header if needed
    // client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
});
```

---

## Converting to Async Operations

For production use, the interface should use async methods. Here's how to migrate:

### Updated Interface

```csharp
public interface IDataService
{
    Task<List<Customer>> GetCustomersAsync(CancellationToken cancellationToken = default);
    Task<Customer?> GetCustomerByIdAsync(string id, CancellationToken cancellationToken = default);
    Task UpdateCustomerAsync(string customerId, string location, string phone, string email, List<string> farmIds, CancellationToken cancellationToken = default);
    // ... other methods
}
```

### Updated Component Usage

```razor
@code {
    private List<Customer>? customers;

    protected override async Task OnInitializedAsync()
    {
        customers = await DataService.GetCustomersAsync();
    }
}
```

---

## Model Modifications for Database

When using Entity Framework, you may need to modify models:

### Add Navigation Properties

```csharp
public class Customer
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    // ... other properties

    // Navigation properties
    public virtual ICollection<Farm> Farms { get; set; } = new List<Farm>();
    public virtual ICollection<Contract> Contracts { get; set; } = new List<Contract>();
    public virtual ICollection<Note> Notes { get; set; } = new List<Note>();
}

public class Farm
{
    public string Id { get; set; } = string.Empty;
    // ... other properties

    // Foreign key
    public string? CustomerId { get; set; }
    public virtual Customer? Customer { get; set; }
}
```

### Handle Computed Properties

The `StoredGrain.AccumulatedStorageCost` property should be marked as not mapped:

```csharp
[NotMapped]
public decimal AccumulatedStorageCost => // calculation
```

Or compute it in a view or stored procedure.

---

## Authentication Integration

When adding authentication:

1. Replace `OriginatorName` in `Note` with `UserId`
2. Add `CreatedBy` and `ModifiedBy` audit fields to entities
3. Inject `IHttpContextAccessor` to get current user

```csharp
public class EFDataService : IDataService
{
    private readonly ApplicationDbContext _context;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public EFDataService(ApplicationDbContext context, IHttpContextAccessor httpContextAccessor)
    {
        _context = context;
        _httpContextAccessor = httpContextAccessor;
    }

    public void AddNote(string customerId, string? farmId, string originatorName, string content)
    {
        var userId = _httpContextAccessor.HttpContext?.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        var note = new Note
        {
            Id = Guid.NewGuid().ToString(),
            CustomerId = customerId,
            FarmId = farmId,
            OriginatorName = originatorName, // Or use userId
            Content = content,
            Timestamp = DateTime.UtcNow
        };

        _context.Notes.Add(note);
        _context.SaveChanges();
    }
}
```

---

## Testing Data Integration

Create integration tests to verify your data service implementation:

```csharp
[TestClass]
public class DataServiceTests
{
    private IDataService _dataService;

    [TestInitialize]
    public void Setup()
    {
        // Use in-memory database for testing
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(databaseName: "TestDb")
            .Options;

        var context = new ApplicationDbContext(options);
        _dataService = new EFDataService(context);
    }

    [TestMethod]
    public void GetCustomers_ReturnsAllCustomers()
    {
        var customers = _dataService.GetCustomers();
        Assert.IsNotNull(customers);
    }
}
```

---

## Checklist for Production

- [ ] Choose data integration approach (EF Core or API)
- [ ] Update model classes with proper annotations
- [ ] Implement new data service
- [ ] Add connection strings/API configuration
- [ ] Update Program.cs service registration
- [ ] Add database migrations (if using EF)
- [ ] Convert to async operations
- [ ] Add error handling and logging
- [ ] Implement retry policies for API calls
- [ ] Add authentication integration
- [ ] Write integration tests
- [ ] Performance test with production data volumes
