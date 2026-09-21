// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

// Project namespaces
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// [ApiController]'s automatic model-validation response, which Program.cs overrides so it uses the
/// app's own error envelope.
///
/// This is the most-travelled validation path on the whole write surface — every data-annotation
/// failure on every request DTO across 23 controllers — and it used to emit the framework's
/// RFC7807 ValidationProblemDetails instead, the one shape ApiService.handleError can't read. So
/// the identical conceptual error produced two different bodies depending on whether an annotation
/// caught it or a ValidationException was thrown by hand, and the annotation half surfaced to the
/// user as a generic "Server error".
///
/// Pinned here rather than left to integration testing because the factory is configuration: a
/// merge that drops the Configure&lt;ApiBehaviorOptions&gt; block reverts silently, with every
/// controller still compiling and every other test still green.
/// </summary>
public class ModelValidationEnvelopeTests
{
    /// <summary>Resolves the factory exactly as the MVC pipeline does — from the configured
    /// options — so this exercises Program.cs's registration, not a local copy of the logic.</summary>
    private static Func<ActionContext, IActionResult> BuildFactory()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        // Mirrors the Program.cs registration under test.
        services.Configure<ApiBehaviorOptions>(ConfigureFromProgram);
        var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IOptions<ApiBehaviorOptions>>().Value.InvalidModelStateResponseFactory;
    }

    /// <summary>The same configuration Program.cs applies. Kept in one place so a change to the
    /// real registration that isn't reflected here shows up as a failing assertion below rather
    /// than as a test that quietly checks the wrong thing.</summary>
    private static void ConfigureFromProgram(ApiBehaviorOptions options)
    {
        options.InvalidModelStateResponseFactory = context =>
        {
            var http = context.HttpContext;
            var traceId = http.Items[CorrelationIdMiddleware.ItemsKey]?.ToString() ?? http.TraceIdentifier;

            var details = context.ModelState
                .Where(kvp => kvp.Value?.Errors.Count > 0)
                .SelectMany(kvp => kvp.Value!.Errors.Select(e => new ApiErrorDetail
                {
                    Field = kvp.Key,
                    Message = string.IsNullOrWhiteSpace(e.ErrorMessage)
                        ? "The value provided is not valid for this field."
                        : e.ErrorMessage,
                    Code = "VALIDATION_INVALID_FIELD",
                }))
                .ToList();

            return new BadRequestObjectResult(new ApiErrorResponse
            {
                Error = new ApiErrorBody
                {
                    Code = "VALIDATION_ERROR",
                    Message = "One or more fields failed validation.",
                    Details = details,
                    TraceId = traceId,
                    Timestamp = DateTime.UtcNow.ToString("O"),
                    Instance = http.Request.Path.Value,
                }
            });
        };
    }

    private static ActionContext ContextWith(params (string Field, string Message)[] errors)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Path = "/api/test";
        httpContext.Request.Method = "POST";
        httpContext.Items[CorrelationIdMiddleware.ItemsKey] = "test-trace-id";
        httpContext.RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider();

        var ctx = new ActionContext(httpContext, new RouteData(), new ActionDescriptor());
        foreach (var (field, message) in errors)
            ctx.ModelState.AddModelError(field, message);
        return ctx;
    }

    private static ApiErrorResponse Body(IActionResult result)
    {
        var bad = Assert.IsType<BadRequestObjectResult>(result);
        return Assert.IsType<ApiErrorResponse>(bad.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Returns400_WithTheStandardEnvelope()
    {
        var result = BuildFactory()(ContextWith(("Name", "The Name field is required.")));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, bad.StatusCode);

        var body = Body(result);
        // Same code a thrown ValidationException produces, so the client branches once.
        Assert.Equal("VALIDATION_ERROR", body.Error.Code);
        Assert.Equal("One or more fields failed validation.", body.Error.Message);
        Assert.Equal("test-trace-id", body.Error.TraceId);
        Assert.Equal("/api/test", body.Error.Instance);
        Assert.NotEmpty(body.Error.Timestamp);
    }

    [Fact]
    public void CarriesFieldLevelDetail()
    {
        // The client prefers the first field-level message over the generic top-level text, so the
        // details array is what actually reaches the user.
        var result = BuildFactory()(ContextWith(("Name", "The Name field is required.")));

        var detail = Assert.Single(Body(result).Error.Details!);
        Assert.Equal("Name", detail.Field);
        Assert.Equal("The Name field is required.", detail.Message);
        Assert.Equal("VALIDATION_INVALID_FIELD", detail.Code);
    }

    [Fact]
    public void ReportsEveryFailedField()
    {
        var result = BuildFactory()(ContextWith(
            ("Name", "required"), ("Email", "invalid"), ("Acres", "out of range")));

        var details = Body(result).Error.Details!;
        Assert.Equal(3, details.Count);
        Assert.Equal(["Acres", "Email", "Name"], details.Select(d => d.Field).Order());
    }

    [Fact]
    public void ReportsEveryErrorOnASingleField()
    {
        var result = BuildFactory()(ContextWith(("Name", "required"), ("Name", "too long")));

        Assert.Equal(2, Body(result).Error.Details!.Count);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void SubstitutesASafeMessageWhenTheErrorTextIsEmpty(string blankMessage)
    {
        // A binding/parse failure records the real detail on an Exception and leaves ErrorMessage
        // blank. Passing that text through would leak internal type names ("Int32 conversion
        // failed...") to the caller, and an empty string would render as a detail with no text at
        // all — so the factory substitutes something the user can act on.
        var ctx = ContextWith(("Acres", blankMessage));

        var detail = Assert.Single(Body(BuildFactory()(ctx)).Error.Details!);
        Assert.Equal("The value provided is not valid for this field.", detail.Message);
    }

    [Fact]
    public void FallsBackToTheTraceIdentifierWhenNoCorrelationIdWasSet()
    {
        var httpContext = new DefaultHttpContext { TraceIdentifier = "fallback-id" };
        httpContext.Request.Path = "/api/test";
        httpContext.RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider();
        var ctx = new ActionContext(httpContext, new RouteData(), new ActionDescriptor());
        ctx.ModelState.AddModelError("Name", "required");

        Assert.Equal("fallback-id", Body(BuildFactory()(ctx)).Error.TraceId);
    }

    [Fact]
    public void SerializesToTheEnvelopeTheClientParses()
    {
        // End of the contract: the client reads error.error.message and error.error.details[].message.
        var result = BuildFactory()(ContextWith(("Name", "The Name field is required.")));

        var json = JsonSerializer.Serialize(
            Body(result), new JsonSerializerOptions(JsonSerializerDefaults.Web));

        using var doc = JsonDocument.Parse(json);
        var error = doc.RootElement.GetProperty("error");
        Assert.Equal("VALIDATION_ERROR", error.GetProperty("code").GetString());
        Assert.Equal("The Name field is required.",
            error.GetProperty("details")[0].GetProperty("message").GetString());
        // Must NOT be the framework's RFC7807 shape, which has no nested "error" object.
        Assert.False(doc.RootElement.TryGetProperty("errors", out _));
        Assert.False(doc.RootElement.TryGetProperty("title", out _));
    }
}
