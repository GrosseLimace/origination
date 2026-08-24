# C# / .NET Style Guide

Use the following guidelines for writing C# and .NET applications.

## Minimum Version Requirements

| Technology | Minimum Version | Notes                |
| ---------- | --------------- | -------------------- |
| .NET       | 10+             | Use latest LTS release |

If `dotnet new` defaults to an older version, explicitly specify the framework flag (e.g., `--framework net10.0`). Never silently create a project on an older major version — upgrading after the fact is costly.

## General Guidelines

- Use .NET 10 or later
- Prefer dependency injection and interface-based design
- Follow SOLID principles
- Provide comprehensive testing with xUnit, NUnit, or MSTest
- Use async/await for all I/O-bound operations

## Reference Style Guides

This guide builds upon and references:

- **[Microsoft C# Coding Conventions](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions)** - Primary reference
- **[Google C# Style Guide](https://google.github.io/styleguide/csharp-style.html)** - Additional conventions
- **[.NET Framework Design Guidelines](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/)** - API design
- **[Google JSON Style Guide](https://google.github.io/styleguide/jsoncstyleguide.xml)** - For configuration files

## Environment Setup

Use .NET CLI for project management:

```bash
# Create new solution
dotnet new sln -n ProjectName

# Create projects
dotnet new webapi -n ProjectName.Api
dotnet new classlib -n ProjectName.Core
dotnet new classlib -n ProjectName.Infrastructure
dotnet new xunit -n ProjectName.Tests

# Add projects to solution
dotnet sln add ProjectName.Api
dotnet sln add ProjectName.Core
dotnet sln add ProjectName.Infrastructure
dotnet sln add ProjectName.Tests

# Run application
dotnet run --project ProjectName.Api

# Run tests
dotnet test
```

## Project Structure (Simplified Clean Architecture)

A simplified 2-project structure with a service layer that maintains clean separation of concerns while reducing ceremony.

```text
ProjectName/
├── src/
│   ├── ProjectName.Api/              # Presentation + Application layer
│   │   ├── Controllers/              # HTTP endpoints
│   │   ├── Exceptions/               # Application exceptions
│   │   ├── Interfaces/               # Service interfaces
│   │   ├── Middleware/               # HTTP pipeline middleware
│   │   ├── Models/
│   │   │   ├── Requests/             # API request DTOs
│   │   │   └── Responses/            # API response DTOs
│   │   ├── Services/                 # Business logic services
│   │   └── Program.cs
│   │
│   └── ProjectName.Infrastructure/   # Data + Domain layer
│       ├── Data/
│       │   ├── Configurations/       # EF Core entity configurations
│       │   ├── Entities/             # Domain entities
│       │   └── ApplicationDbContext.cs
│       ├── Enums/                    # Domain enumerations
│       ├── Interfaces/               # Repository interfaces
│       ├── Models/                   # Infrastructure models (filters, results)
│       ├── Repositories/             # Data access implementations
│       ├── Services/                 # Infrastructure services (e.g., Excel import)
│       └── DependencyInjection.cs    # Service registration extension
│
├── tests/
│   ├── ProjectName.Api.Tests/        # Integration tests
│   └── ProjectName.Infrastructure.Tests/  # Unit tests
│
├── ProjectName.sln
└── .editorconfig
```

### Project References

```
Api → Infrastructure (only reference needed)
```

### Key Design Decisions

1. **Service Layer Pattern** - Controllers inject service interfaces (e.g., `IUserService`) instead of repository interfaces. Services handle entity-to-DTO mapping and business logic coordination.

2. **Manual DTO Mapping** - Each service contains private mapping methods for entity-to-DTO conversion, keeping mapping logic close to the service.

3. **Entities in Infrastructure** - Entities remain in `Infrastructure/Data/Entities/` alongside EF configurations, keeping all database concerns together.

4. **Exception Hierarchy** - Application exceptions live in `Api/Exceptions/`. The `ExceptionHandlingMiddleware` catches these and returns structured JSON responses.

### Adding New Features

| Feature Type | Location |
|-------------|----------|
| New Entity | `Infrastructure/Data/Entities/` + configuration in `Infrastructure/Data/Configurations/` |
| New Repository | Interface in `Infrastructure/Interfaces/`, implementation in `Infrastructure/Repositories/` |
| New API Endpoint | Controller in `Api/Controllers/`, service interface in `Api/Interfaces/`, implementation in `Api/Services/` |
| New DTO | `Api/Models/Requests/` or `Api/Models/Responses/` |

## Naming Conventions

### General Rules

| Element | Convention | Example |
| ------- | ---------- | ------- |
| Class | PascalCase | `UserService` |
| Interface | PascalCase with I prefix | `IUserService` |
| Method | PascalCase | `GetUserById` |
| Property | PascalCase | `FirstName` |
| Field (private) | camelCase with underscore | `_userRepository` |
| Field (public) | PascalCase | `MaxRetryCount` |
| Parameter | camelCase | `userId` |
| Local variable | camelCase | `userName` |
| Constant | PascalCase | `DefaultPageSize` |
| Enum | PascalCase (singular) | `UserRole` |
| Enum value | PascalCase | `Administrator` |

### File Naming

- One class/interface per file
- File name matches the type name: `UserService.cs`
- Interface files: `IUserService.cs`
- Test files: `UserServiceTests.cs`

## Formatting

Whitespace conformance is enforced at PR time, so it is not a matter of taste or
of reviewer attention. Run `dotnet format whitespace` before pushing.

Only the `whitespace` subcommand is enforced, deliberately. The full
`dotnet format` also runs the style and analyzer formatters, and those need
NuGet packages restored to resolve type references — so they fail with
unrelated `CS0246` errors on a gate that has not restored. Style and analyzer
concerns belong to Roslyn analyzers configured in the projects themselves.

```rule
id: csharp-whitespace-formatted
source: csharp.md§Formatting
severity: error
description: C# projects must be whitespace-formatted (dotnet format whitespace --verify-no-changes)
applies-to: [changed-files]
files: ['*.cs', '*.csproj']
tool: dotnet-format-whitespace
message: |
  C# whitespace formatting does not match. Run `dotnet format whitespace <sln-or-csproj>`
  and commit the result. See csharp.md §Formatting.
```

### Indentation and Spacing

- **Indentation**: 4 spaces (no tabs)
- **Line length**: 120 characters max (soft limit)
- **Braces**: Opening brace on new line (Allman style)
- **Blank lines**: One blank line between method definitions

```csharp
// ✅ Correct formatting
public class UserService : IUserService
{
    private readonly IUserRepository _userRepository;
    private readonly ILogger<UserService> _logger;

    public UserService(
        IUserRepository userRepository,
        ILogger<UserService> logger)
    {
        _userRepository = userRepository;
        _logger = logger;
    }

    public async Task<User?> GetUserByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Getting user with ID: {UserId}", id);

        var user = await _userRepository.GetByIdAsync(id, cancellationToken);

        if (user is null)
        {
            _logger.LogWarning("User not found: {UserId}", id);
        }

        return user;
    }
}
```

### Using Directives

Organize using directives in this order:

1. System namespaces
2. Microsoft namespaces
3. Third-party namespaces
4. Project namespaces

```csharp
// System namespaces
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using AutoMapper;
using FluentValidation;

// Project namespaces
using ProjectName.Core.Entities;
using ProjectName.Core.Interfaces;
```

## Type Definitions

### Classes

```csharp
// =============================================================================
/// <summary>
/// Service for managing user operations.
/// </summary>
public class UserService : IUserService
{
    private readonly IUserRepository _userRepository;
    private readonly IMapper _mapper;
    private readonly ILogger<UserService> _logger;

    // -------------------------------------------------------------------------
    /// <summary>
    /// Initializes a new instance of the <see cref="UserService"/> class.
    /// </summary>
    public UserService(
        IUserRepository userRepository,
        IMapper mapper,
        ILogger<UserService> logger)
    {
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
        _mapper = mapper ?? throw new ArgumentNullException(nameof(mapper));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    // -------------------------------------------------------------------------
    /// <inheritdoc/>
    public async Task<UserDto?> GetUserByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var user = await _userRepository.GetByIdAsync(id, cancellationToken);
        return user is null ? null : _mapper.Map<UserDto>(user);
    }
}
```

### Records (for DTOs and immutable data)

```csharp
// Simple record for data transfer
public record UserDto(int Id, string FirstName, string LastName, string Email);

// Record with additional properties
public record CreateUserRequest
{
    public required string FirstName { get; init; }
    public required string LastName { get; init; }
    public required string Email { get; init; }
    public string? PhoneNumber { get; init; }
}

// Record with validation
public record PaginatedRequest
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 10;

    public int Skip => (Page - 1) * PageSize;
}
```

### Interfaces

```csharp
/// <summary>
/// Interface for user repository operations.
/// </summary>
public interface IUserRepository
{
    /// <summary>
    /// Gets a user by their unique identifier.
    /// </summary>
    /// <param name="id">The user's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The user if found; otherwise, null.</returns>
    Task<User?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets all users with pagination.
    /// </summary>
    Task<IReadOnlyList<User>> GetAllAsync(int skip, int take, CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates a new user.
    /// </summary>
    Task<User> CreateAsync(User user, CancellationToken cancellationToken = default);

    /// <summary>
    /// Updates an existing user.
    /// </summary>
    Task UpdateAsync(User user, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes a user.
    /// </summary>
    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
}
```

### Enums

```csharp
/// <summary>
/// Represents user roles in the system.
/// </summary>
public enum UserRole
{
    /// <summary>Standard user with basic permissions.</summary>
    User = 0,

    /// <summary>Moderator with elevated permissions.</summary>
    Moderator = 1,

    /// <summary>Administrator with full permissions.</summary>
    Administrator = 2
}
```

## Entity and Model Design

### Domain Entity

```csharp
/// <summary>
/// Represents a user in the system.
/// </summary>
public class User
{
    public int Id { get; private set; }
    public string FirstName { get; private set; } = string.Empty;
    public string LastName { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public UserRole Role { get; private set; } = UserRole.User;
    public DateTime CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }

    // Private constructor for EF Core
    private User() { }

    // Factory method for creation
    public static User Create(string firstName, string lastName, string email)
    {
        if (string.IsNullOrWhiteSpace(firstName))
            throw new ArgumentException("First name is required.", nameof(firstName));

        if (string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Email is required.", nameof(email));

        return new User
        {
            FirstName = firstName,
            LastName = lastName,
            Email = email.ToLowerInvariant(),
            CreatedAt = DateTime.UtcNow
        };
    }

    // Domain methods
    public void UpdateName(string firstName, string lastName)
    {
        FirstName = firstName ?? throw new ArgumentNullException(nameof(firstName));
        LastName = lastName ?? throw new ArgumentNullException(nameof(lastName));
        UpdatedAt = DateTime.UtcNow;
    }

    public void ChangeRole(UserRole newRole)
    {
        Role = newRole;
        UpdatedAt = DateTime.UtcNow;
    }

    // Computed property
    public string FullName => $"{FirstName} {LastName}";
}
```

## API Controllers

```csharp
/// <summary>
/// API controller for user operations.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly ILogger<UsersController> _logger;

    public UsersController(IUserService userService, ILogger<UsersController> logger)
    {
        _userService = userService;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Gets all users with pagination.
    /// </summary>
    /// <param name="request">Pagination parameters.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A paginated list of users.</returns>
    [HttpGet]
    [ProducesResponseType(typeof(PaginatedResponse<UserDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<PaginatedResponse<UserDto>>> GetUsers(
        [FromQuery] PaginatedRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _userService.GetUsersAsync(request, cancellationToken);
        return Ok(result);
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Gets a user by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UserDto>> GetUser(int id, CancellationToken cancellationToken)
    {
        var user = await _userService.GetUserByIdAsync(id, cancellationToken);

        if (user is null)
        {
            return NotFound();
        }

        return Ok(user);
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Creates a new user.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<UserDto>> CreateUser(
        [FromBody] CreateUserRequest request,
        CancellationToken cancellationToken)
    {
        var user = await _userService.CreateUserAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetUser), new { id = user.Id }, user);
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Updates an existing user.
    /// </summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateUser(
        int id,
        [FromBody] UpdateUserRequest request,
        CancellationToken cancellationToken)
    {
        var success = await _userService.UpdateUserAsync(id, request, cancellationToken);

        if (!success)
        {
            return NotFound();
        }

        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Deletes a user.
    /// </summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteUser(int id, CancellationToken cancellationToken)
    {
        var success = await _userService.DeleteUserAsync(id, cancellationToken);

        if (!success)
        {
            return NotFound();
        }

        return NoContent();
    }
}
```

## Outbound Calls, Batching, and Caching

### Outbound Call Design

Backend code MUST avoid chatty I/O patterns where one logical operation triggers many small outbound calls to databases, internal services, or third-party APIs.

Prefer these patterns:

- fetch the minimum data needed for the current operation
- batch related lookups when the dependency supports it
- shape queries so one request does the work of many per-item calls
- reuse outbound HTTP clients through `IHttpClientFactory` or approved long-lived clients
- cache repeated, relatively static reads when correctness allows it

Avoid these patterns:

- looping over items and making one outbound HTTP or database call per item
- creating a new `HttpClient` per request
- re-fetching the same reference data repeatedly within a request or hot path
- loading full objects or large result sets "just in case" when a smaller projection would do
- adding caching without clear invalidation, ownership, or consistency rules

### Batching Rules

- If one workflow needs data for multiple items, first ask whether the dependency supports batch retrieval.
- If batch retrieval is available, prefer it over repeated per-item requests.
- If batch retrieval is not available, document the limitation and minimize round trips through concurrency control, projection, or local aggregation.
- Keep batch size explicit. Do not create unbounded "fetch everything" queries to avoid per-item calls.

### Caching Rules

- Cache only data that is expensive enough and stable enough to justify the complexity.
- Prefer cache-aside patterns for read-heavy reference data.
- Use in-memory caching only when single-instance behavior is acceptable.
- Use distributed or hybrid caching when multiple app instances must share cached results.
- Define cache key shape, TTL, invalidation triggers, and stale-data tolerance before adding a cache.
- Do not use caching to hide correctness bugs or missing indexes.

### HTTP Client Rules

- Use `IHttpClientFactory` for named or typed clients when integrating with external or internal HTTP APIs.
- Configure client timeouts, retry policies, and base addresses centrally.
- Reuse connections intentionally. Do not allocate and dispose `HttpClient` per call.
- Keep outbound call composition inside services or dedicated client abstractions, not controllers.

### Review Heuristics

During implementation and review, treat these as warning signs:

- repeated `await` calls inside loops over collections
- service methods that hydrate one DTO by calling multiple dependencies per item
- endpoints that fetch static lookup data on every request
- duplicate reference-data queries across multiple services
- outbound API wrappers with no caching, batching, or projection strategy on hot paths

### Good Example

```csharp
public async Task<IReadOnlyList<OrderSummaryDto>> GetOrdersAsync(
    IReadOnlyCollection<int> orderIds,
    CancellationToken cancellationToken)
{
    var orders = await _orderRepository.GetSummariesByIdsAsync(orderIds, cancellationToken);

    var customerIds = orders
        .Select(order => order.CustomerId)
        .Distinct()
        .ToArray();

    var customers = await _customerClient.GetCustomersByIdsAsync(customerIds, cancellationToken);
    var customerMap = customers.ToDictionary(customer => customer.Id);

    return orders
        .Select(order => new OrderSummaryDto(
            order.Id,
            order.Number,
            customerMap[order.CustomerId].DisplayName,
            order.Total))
        .ToArray();
}
```

### Bad Example

```csharp
public async Task<IReadOnlyList<OrderSummaryDto>> GetOrdersAsync(
    IReadOnlyCollection<int> orderIds,
    CancellationToken cancellationToken)
{
    var results = new List<OrderSummaryDto>();

    foreach (var orderId in orderIds)
    {
        var order = await _orderRepository.GetByIdAsync(orderId, cancellationToken);
        var customer = await _customerClient.GetCustomerAsync(order.CustomerId, cancellationToken);

        results.Add(new OrderSummaryDto(
            order.Id,
            order.Number,
            customer.DisplayName,
            order.Total));
    }

    return results;
}
```

In the bad example, one logical operation degrades into repeated per-item database and HTTP calls. The result is higher latency, more dependency pressure, and worse failure behavior.

## Exception Handling

### Custom Exceptions

```csharp
/// <summary>
/// Base exception for all application-specific errors.
/// </summary>
public abstract class ApplicationException : Exception
{
    public string ErrorCode { get; }
    public IDictionary<string, object> Context { get; }

    protected ApplicationException(string message, string errorCode)
        : base(message)
    {
        ErrorCode = errorCode;
        Context = new Dictionary<string, object>();
    }

    protected ApplicationException(string message, string errorCode, Exception innerException)
        : base(message, innerException)
    {
        ErrorCode = errorCode;
        Context = new Dictionary<string, object>();
    }

    public ApplicationException WithContext(string key, object value)
    {
        Context[key] = value;
        return this;
    }
}

/// <summary>
/// Exception thrown when a requested entity is not found.
/// </summary>
public class NotFoundException : ApplicationException
{
    public NotFoundException(string entityName, object key)
        : base($"{entityName} with key '{key}' was not found.", "NOT_FOUND")
    {
        WithContext("EntityName", entityName);
        WithContext("Key", key);
    }
}

/// <summary>
/// Exception thrown when validation fails.
/// </summary>
public class ValidationException : ApplicationException
{
    public IReadOnlyDictionary<string, string[]> Errors { get; }

    public ValidationException(IDictionary<string, string[]> errors)
        : base("One or more validation errors occurred.", "VALIDATION_ERROR")
    {
        Errors = new Dictionary<string, string[]>(errors);
    }
}
```

### Global Exception Handler

```csharp
public class GlobalExceptionHandler : IExceptionHandler
{
    private readonly ILogger<GlobalExceptionHandler> _logger;

    public GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger)
    {
        _logger = logger;
    }

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        _logger.LogError(exception, "Unhandled exception occurred: {Message}", exception.Message);

        var (statusCode, response) = exception switch
        {
            NotFoundException notFound => (
                StatusCodes.Status404NotFound,
                new ProblemDetails
                {
                    Status = StatusCodes.Status404NotFound,
                    Title = "Not Found",
                    Detail = notFound.Message
                }),

            ValidationException validation => (
                StatusCodes.Status400BadRequest,
                new ValidationProblemDetails(validation.Errors)
                {
                    Status = StatusCodes.Status400BadRequest,
                    Title = "Validation Error"
                }),

            _ => (
                StatusCodes.Status500InternalServerError,
                new ProblemDetails
                {
                    Status = StatusCodes.Status500InternalServerError,
                    Title = "Server Error",
                    Detail = "An unexpected error occurred."
                })
        };

        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(response, cancellationToken);

        return true;
    }
}
```

## Testing

### Unit Test Example

```csharp
public class UserServiceTests
{
    private readonly Mock<IUserRepository> _userRepositoryMock;
    private readonly Mock<IMapper> _mapperMock;
    private readonly Mock<ILogger<UserService>> _loggerMock;
    private readonly UserService _sut;

    public UserServiceTests()
    {
        _userRepositoryMock = new Mock<IUserRepository>();
        _mapperMock = new Mock<IMapper>();
        _loggerMock = new Mock<ILogger<UserService>>();
        _sut = new UserService(
            _userRepositoryMock.Object,
            _mapperMock.Object,
            _loggerMock.Object);
    }

    [Fact]
    public async Task GetUserByIdAsync_WhenUserExists_ReturnsUserDto()
    {
        // Arrange
        var userId = 1;
        var user = User.Create("John", "Doe", "john@example.com");
        var expectedDto = new UserDto(userId, "John", "Doe", "john@example.com");

        _userRepositoryMock
            .Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);

        _mapperMock
            .Setup(x => x.Map<UserDto>(user))
            .Returns(expectedDto);

        // Act
        var result = await _sut.GetUserByIdAsync(userId);

        // Assert
        result.Should().NotBeNull();
        result.Should().BeEquivalentTo(expectedDto);
    }

    [Fact]
    public async Task GetUserByIdAsync_WhenUserDoesNotExist_ReturnsNull()
    {
        // Arrange
        var userId = 999;

        _userRepositoryMock
            .Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);

        // Act
        var result = await _sut.GetUserByIdAsync(userId);

        // Assert
        result.Should().BeNull();
    }
}
```

## Modern C# Features (C# 10+)

### Recommended Features

```csharp
// File-scoped namespaces
namespace ProjectName.Core.Services;

// Global using directives (in GlobalUsings.cs)
global using System;
global using System.Collections.Generic;
global using System.Threading.Tasks;

// Required members
public class CreateUserCommand
{
    public required string FirstName { get; init; }
    public required string Email { get; init; }
}

// Pattern matching
public string GetUserStatus(User user) => user switch
{
    { Role: UserRole.Administrator } => "Admin User",
    { Role: UserRole.Moderator } => "Moderator",
    { CreatedAt: var created } when created > DateTime.UtcNow.AddDays(-7) => "New User",
    _ => "Regular User"
};

// Collection expressions (C# 12)
List<int> numbers = [1, 2, 3, 4, 5];

// Primary constructors (C# 12)
public class UserService(IUserRepository repository, ILogger<UserService> logger) : IUserService
{
    public async Task<User?> GetUserAsync(int id) =>
        await repository.GetByIdAsync(id);
}
```

## Configuration Files

### .editorconfig

```ini
root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.cs]
# Formatting
csharp_new_line_before_open_brace = all
csharp_new_line_before_else = true
csharp_new_line_before_catch = true
csharp_new_line_before_finally = true

# Naming
dotnet_naming_rule.private_fields_should_be_camel_case.severity = suggestion
dotnet_naming_rule.private_fields_should_be_camel_case.symbols = private_fields
dotnet_naming_rule.private_fields_should_be_camel_case.style = camel_case_underscore

dotnet_naming_symbols.private_fields.applicable_kinds = field
dotnet_naming_symbols.private_fields.applicable_accessibilities = private

dotnet_naming_style.camel_case_underscore.capitalization = camel_case
dotnet_naming_style.camel_case_underscore.required_prefix = _

# Code style
csharp_prefer_braces = true:suggestion
csharp_style_var_for_built_in_types = false:suggestion
csharp_style_var_when_type_is_apparent = true:suggestion

[*.{json,xml,yml,yaml}]
indent_size = 2
```

---

*Style Guide Version: 1.0*
*Last Updated: December 2025*
*Based on .NET 10+ and C# 13*
