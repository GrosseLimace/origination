// Microsoft namespaces
using Microsoft.AspNetCore.Diagnostics;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Catches all unhandled exceptions and returns a structured ProblemDetails JSON response.
/// Registered via app.UseExceptionHandler() in Program.cs.
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
        _logger.LogError(exception, "Unhandled exception: {Message}", exception.Message);

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

            Exceptions.ValidationException validation => (
                StatusCodes.Status400BadRequest,
                (ProblemDetails)new ValidationProblemDetails(
                    validation.Errors.ToDictionary(
                        kvp => kvp.Key,
                        kvp => kvp.Value))
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
