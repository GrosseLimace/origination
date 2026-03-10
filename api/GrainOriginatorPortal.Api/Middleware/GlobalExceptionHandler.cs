// Microsoft namespaces
using Microsoft.AspNetCore.Diagnostics;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Catches all unhandled exceptions and returns a structured <see cref="ApiErrorResponse"/>
/// per error-handling-standards.md §2. Registered via app.UseExceptionHandler() in Program.cs.
/// Log levels follow §4.2: Information for not-found, Warning for validation/business,
/// Error for infrastructure, Critical for unexpected.
/// </summary>
public class GlobalExceptionHandler : IExceptionHandler
{
    private readonly ILogger<GlobalExceptionHandler> _logger;

    // -------------------------------------------------------------------------
    public GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger)
    {
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var traceId = httpContext.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
            ?? httpContext.TraceIdentifier;

        var timestamp = DateTime.UtcNow.ToString("O");
        var instance = httpContext.Request.Path.Value;

        int statusCode;
        ApiErrorResponse response;

        switch (exception)
        {
            case OperationCanceledException:
                // Client disconnected or request timed out — not a server error, do not log
                httpContext.Response.StatusCode = 499; // Client Closed Request (nginx convention)
                return true;

            case NotFoundException notFound:
                _logger.LogInformation(
                    "Resource not found [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Message}",
                    traceId, "RESOURCE_NOT_FOUND", "NotFound", notFound.Message);

                statusCode = StatusCodes.Status404NotFound;
                response = BuildError("RESOURCE_NOT_FOUND", notFound.Message, traceId, timestamp, instance);
                break;

            case Exceptions.ValidationException validation:
                _logger.LogWarning(
                    "Validation error [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {FieldCount} field(s) failed",
                    traceId, "VALIDATION_ERROR", "Validation", validation.Errors.Count);

                var details = validation.Errors
                    .SelectMany(kvp => kvp.Value.Select(msg => new ApiErrorDetail
                    {
                        Field = kvp.Key,
                        Message = msg,
                        Code = "VALIDATION_INVALID_FIELD"
                    }))
                    .ToList();

                statusCode = StatusCodes.Status400BadRequest;
                response = BuildError("VALIDATION_ERROR", "One or more fields failed validation.", traceId, timestamp, instance, details);
                break;

            case BusinessException business:
                _logger.LogWarning(
                    "Business rule violation [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Message}",
                    traceId, business.ErrorCode, "Business", business.Message);

                statusCode = business.HttpStatusCode;
                response = BuildError(business.ErrorCode, business.Message, traceId, timestamp, instance);
                break;

            case InfrastructureException infra:
                _logger.LogError(
                    exception,
                    "Infrastructure failure [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Message}",
                    traceId, infra.ErrorCode, "Infrastructure", infra.Message);

                statusCode = infra.HttpStatusCode;
                response = BuildError(
                    infra.ErrorCode,
                    "A service dependency is unavailable. Please try again shortly.",
                    traceId, timestamp, instance);
                break;

            default:
                _logger.LogCritical(
                    exception,
                    "Unhandled exception [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Message}",
                    traceId, "INTERNAL_ERROR", "Unexpected", exception.Message);

                statusCode = StatusCodes.Status500InternalServerError;
                response = BuildError(
                    "INTERNAL_ERROR",
                    $"Something went wrong on our end. If this persists, contact support. (Ref: {traceId})",
                    traceId, timestamp, instance);
                break;
        }

        httpContext.Response.StatusCode = statusCode;

        // §5: ALWAYS include Retry-After header with 429 and 503 responses
        if (statusCode == StatusCodes.Status503ServiceUnavailable ||
            statusCode == StatusCodes.Status429TooManyRequests)
        {
            httpContext.Response.Headers["Retry-After"] = "30";
        }

        await httpContext.Response.WriteAsJsonAsync(response, cancellationToken);

        return true;
    }

    // -------------------------------------------------------------------------
    private static ApiErrorResponse BuildError(
        string code,
        string message,
        string traceId,
        string timestamp,
        string? instance,
        IReadOnlyList<ApiErrorDetail>? details = null)
        => new()
        {
            Error = new ApiErrorBody
            {
                Code = code,
                Message = message,
                Details = details,
                TraceId = traceId,
                Timestamp = timestamp,
                Instance = instance
            }
        };
}
