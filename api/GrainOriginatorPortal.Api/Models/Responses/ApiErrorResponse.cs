namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Standard API error response envelope per error-handling-standards.md §2.
/// All API error responses use this structure — no exceptions.
/// </summary>
public record ApiErrorResponse
{
    public required ApiErrorBody Error { get; init; }
}

/// <summary>Top-level error body within <see cref="ApiErrorResponse"/>.</summary>
public record ApiErrorBody
{
    /// <summary>Machine-readable UPPER_SNAKE_CASE code mapped to the error classification.</summary>
    public required string Code { get; init; }

    /// <summary>Human-readable summary for developers. Never expose directly in production UI.</summary>
    public required string Message { get; init; }

    /// <summary>Field-level sub-errors. Required for validation errors.</summary>
    public IReadOnlyList<ApiErrorDetail>? Details { get; init; }

    /// <summary>Correlation ID that flows through all services for this request.</summary>
    public required string TraceId { get; init; }

    /// <summary>ISO 8601 UTC timestamp when the error occurred.</summary>
    public required string Timestamp { get; init; }

    /// <summary>The API path that generated the error.</summary>
    public string? Instance { get; init; }
}

/// <summary>Field-level detail within a validation error response.</summary>
public record ApiErrorDetail
{
    public required string Field { get; init; }
    public required string Message { get; init; }
    public required string Code { get; init; }
}
