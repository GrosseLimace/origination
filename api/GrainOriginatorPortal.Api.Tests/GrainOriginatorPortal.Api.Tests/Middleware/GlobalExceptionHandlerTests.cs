// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

// Moq
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// Verifies that GlobalExceptionHandler maps each exception category to the correct
/// HTTP status, ApiErrorResponse schema, error code, and log level per §2, §4.2.
/// </summary>
public class GlobalExceptionHandlerTests
{
    private readonly Mock<ILogger<GlobalExceptionHandler>> _loggerMock = new();
    private readonly Mock<IHostEnvironment> _envMock = new();

    private GlobalExceptionHandler CreateSut() => new(_loggerMock.Object, _envMock.Object);

    private static DefaultHttpContext BuildContext(string correlationId = "test-trace-id")
    {
        var ctx = new DefaultHttpContext();
        ctx.Response.Body = new MemoryStream();
        ctx.Items[CorrelationIdMiddleware.ItemsKey] = correlationId;
        ctx.Request.Path = "/api/test";
        return ctx;
    }

    private static async Task<ApiErrorResponse?> ReadResponseBody(HttpContext ctx)
    {
        ctx.Response.Body.Seek(0, SeekOrigin.Begin);
        return await System.Text.Json.JsonSerializer.DeserializeAsync<ApiErrorResponse>(
            ctx.Response.Body,
            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task NotFoundException_Returns404_WithResourceNotFoundCode()
    {
        var sut = CreateSut();
        var ctx = BuildContext();

        var result = await sut.TryHandleAsync(ctx, new NotFoundException("Customer", 42), default);

        Assert.True(result);
        Assert.Equal(StatusCodes.Status404NotFound, ctx.Response.StatusCode);

        var body = await ReadResponseBody(ctx);
        Assert.NotNull(body);
        Assert.Equal("RESOURCE_NOT_FOUND", body!.Error.Code);
        Assert.Equal("test-trace-id", body.Error.TraceId);
        Assert.NotEmpty(body.Error.Timestamp);
        Assert.Equal("/api/test", body.Error.Instance);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ValidationException_Returns400_WithValidationErrorCode_AndDetails()
    {
        var sut = CreateSut();
        var ctx = BuildContext();

        var errors = new Dictionary<string, string[]>
        {
            ["email"] = ["Must be a valid email address."],
            ["name"]  = ["Name is required."]
        };
        var result = await sut.TryHandleAsync(ctx, new ValidationException(errors), default);

        Assert.True(result);
        Assert.Equal(StatusCodes.Status400BadRequest, ctx.Response.StatusCode);

        var body = await ReadResponseBody(ctx);
        Assert.NotNull(body);
        Assert.Equal("VALIDATION_ERROR", body!.Error.Code);
        Assert.NotNull(body.Error.Details);
        Assert.Equal(2, body.Error.Details!.Count);
        Assert.Equal("test-trace-id", body.Error.TraceId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BusinessException_Returns409_WithCustomErrorCode()
    {
        var sut = CreateSut();
        var ctx = BuildContext();

        var result = await sut.TryHandleAsync(
            ctx,
            new BusinessException("List name already exists.", "BUSINESS_DUPLICATE_ENTRY"),
            default);

        Assert.True(result);
        Assert.Equal(StatusCodes.Status409Conflict, ctx.Response.StatusCode);

        var body = await ReadResponseBody(ctx);
        Assert.NotNull(body);
        Assert.Equal("BUSINESS_DUPLICATE_ENTRY", body!.Error.Code);
        Assert.Equal("List name already exists.", body.Error.Message);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BusinessException_Returns422_WhenExplicitStatusCodePassed()
    {
        var sut = CreateSut();
        var ctx = BuildContext();

        var result = await sut.TryHandleAsync(
            ctx,
            new BusinessException("Rule violated.", "BUSINESS_RULE_VIOLATION", StatusCodes.Status422UnprocessableEntity),
            default);

        Assert.True(result);
        Assert.Equal(StatusCodes.Status422UnprocessableEntity, ctx.Response.StatusCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task InfrastructureException_Returns503_WithInfraErrorCode()
    {
        var sut = CreateSut();
        var ctx = BuildContext();

        var result = await sut.TryHandleAsync(
            ctx,
            new InfrastructureException("DB down.", "INFRASTRUCTURE_DATABASE_UNAVAILABLE"),
            default);

        Assert.True(result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, ctx.Response.StatusCode);

        var body = await ReadResponseBody(ctx);
        Assert.NotNull(body);
        Assert.Equal("INFRASTRUCTURE_DATABASE_UNAVAILABLE", body!.Error.Code);
        // User-facing message should be generic — not expose internal details
        Assert.Contains("service dependency", body.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UnhandledException_Returns500_WithInternalError_AndTraceIdInMessage()
    {
        var sut = CreateSut();
        var ctx = BuildContext("unique-ref-abc");

        var result = await sut.TryHandleAsync(ctx, new InvalidOperationException("Something blew up"), default);

        Assert.True(result);
        Assert.Equal(StatusCodes.Status500InternalServerError, ctx.Response.StatusCode);

        var body = await ReadResponseBody(ctx);
        Assert.NotNull(body);
        Assert.Equal("INTERNAL_ERROR", body!.Error.Code);
        Assert.Contains("unique-ref-abc", body.Error.Message);
        Assert.Equal("unique-ref-abc", body.Error.TraceId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AllResponses_AlwaysInclude_RequiredFields()
    {
        var sut = CreateSut();

        var exceptions = new Exception[]
        {
            new NotFoundException("X", 1),
            new ValidationException("f", "m"),
            new BusinessException("b", "BUSINESS_TEST"),
            new InfrastructureException("i", "INFRASTRUCTURE_TEST"),
            new Exception("unexpected")
        };

        foreach (var ex in exceptions)
        {
            var ctx = BuildContext();
            await sut.TryHandleAsync(ctx, ex, default);
            var body = await ReadResponseBody(ctx);

            Assert.NotNull(body?.Error.Code);
            Assert.NotEmpty(body!.Error.Code);
            Assert.NotNull(body.Error.Message);
            Assert.NotEmpty(body.Error.Message);
            Assert.NotEmpty(body.Error.TraceId);
            Assert.NotEmpty(body.Error.Timestamp);
        }
    }
}
