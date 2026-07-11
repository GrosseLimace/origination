using System.Text.Json;
using System.Text.RegularExpressions;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class FieldTagService : IFieldTagService
{
    private static readonly Regex CluExternalRefPattern = new("^clu:[0-9]+$", RegexOptions.Compiled);
    private static readonly Regex ParcelExternalRefPattern = new("^parcel:.+$", RegexOptions.Compiled);
    private static readonly Regex DrawnExternalRefPattern = new("^drawn:[0-9a-f]{64}$", RegexOptions.Compiled);
    private static readonly Regex CdlYearPattern = new("^[0-9]{4}$", RegexOptions.Compiled);
    private static readonly string[] ValidSelectionMethods = ["clu", "parcel", "drawn"];

    private const int MaxGeometryJsonLength = 1_048_576; // 1 MB
    private const int MaxCdlSnapshotJsonLength = 262_144; // 256 KB

    private readonly IFieldTagRepository? _repository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IProducerDetailsRepository _producerDetailsRepository;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<FieldTagService> _logger;

    public FieldTagService(
        IServiceProvider serviceProvider,
        ICustomerRepository customerRepository,
        IProducerDetailsRepository producerDetailsRepository,
        IRequestContextService requestContext,
        ILogger<FieldTagService> logger)
    {
        // IFieldTagRepository is only registered (by FieldTagsPocDependencyInjection) when
        // FieldTags:LocalStorePath is configured. Resolving it via IServiceProvider.GetService
        // (rather than a required constructor parameter) lets this service — and everything that
        // depends on it — construct cleanly even when the POC is dormant.
        _repository = serviceProvider.GetService(typeof(IFieldTagRepository)) as IFieldTagRepository;
        _customerRepository = customerRepository;
        _producerDetailsRepository = producerDetailsRepository;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<FieldTagResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        if (_repository is null)
        {
            return [];
        }

        var tags = await _repository.GetByCustomerAsync(customerId, cancellationToken);
        return tags.Select(t => t.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<FieldTagResponse> CreateAsync(long customerId, CreateFieldTagRequest request, CancellationToken cancellationToken)
    {
        if (_repository is null)
        {
            throw new BusinessException("Field tagging is not enabled on this environment.", "FIELD_TAGS_DISABLED");
        }

        ValidateCreateRequest(request);

        _ = await _customerRepository.GetByIdAsync(customerId, cancellationToken)
            ?? throw new NotFoundException("Customer", customerId);

        var existing = await _repository.GetActiveByExternalRefAsync(customerId, request.ExternalRef, cancellationToken);
        if (existing is not null)
        {
            throw new BusinessException("A tag for this field already exists for this customer.", "FIELD_TAG_DUPLICATE");
        }

        var tag = new CustomerFieldTag
        {
            CustomerId = customerId,
            SelectionMethod = request.SelectionMethod,
            GeometryJson = request.GeometryJson,
            CalcAcres = request.CalcAcres,
            ExternalRef = request.ExternalRef,
            CdlYear = request.CdlYear,
            CdlSnapshotJson = request.CdlSnapshotJson,
            CreatedBy = _requestContext.GetCurrentUser(),
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            tag = await _repository.AddAsync(tag, cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            // Race-condition backstop: the client pre-checks against loaded ExternalRefs, so this
            // should be rare in practice — the unique filtered index is the source of truth.
            throw new BusinessException("A tag for this field already exists for this customer.", "FIELD_TAG_DUPLICATE", StatusCodes.Status409Conflict);
        }

        return tag.ToResponse();
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long customerId, int id, CancellationToken cancellationToken)
    {
        if (_repository is null)
        {
            throw new BusinessException("Field tagging is not enabled on this environment.", "FIELD_TAGS_DISABLED");
        }

        var currentUser = _requestContext.GetCurrentUser();
        var deleted = await _repository.DeleteAsync(customerId, id, currentUser, cancellationToken);
        if (!deleted)
        {
            throw new NotFoundException("FieldTag", id);
        }
    }

    /// <inheritdoc />
    public async Task<ApplyCalculatedAcresResponse> ApplyCalculatedAcresAsync(long customerId, CancellationToken cancellationToken)
    {
        if (_repository is null)
        {
            throw new BusinessException("Field tagging is not enabled on this environment.", "FIELD_TAGS_DISABLED");
        }

        var tags = await _repository.GetByCustomerAsync(customerId, cancellationToken);
        if (tags.Count == 0)
        {
            throw new BusinessException("No active field tags to calculate acres from.", "FIELD_TAGS_EMPTY");
        }

        // SQLite provider can't translate SumAsync on a decimal column — sum in memory
        // (trivially fine at field-tag cardinality). Null CalcAcres contributes 0.
        var sum = tags.Sum(t => t.CalcAcres ?? 0m);
        var totalAcres = Math.Round(sum, 1, MidpointRounding.AwayFromZero);

        var currentUser = _requestContext.GetCurrentUser();
        await _producerDetailsRepository.UpdateTotalAcresAsync(customerId, totalAcres, currentUser, cancellationToken);

        return new ApplyCalculatedAcresResponse
        {
            CustomerId = customerId,
            TotalAcres = totalAcres,
            TagCount = tags.Count
        };
    }

    private static void ValidateCreateRequest(CreateFieldTagRequest request)
    {
        if (!ValidSelectionMethods.Contains(request.SelectionMethod))
        {
            throw new ValidationException("selectionMethod", "selectionMethod must be one of: clu, parcel, drawn.");
        }

        if (request.GeometryJson.Length > MaxGeometryJsonLength)
        {
            throw new ValidationException("geometryJson", "geometryJson exceeds the 1 MB size limit.");
        }

        ValidateGeometryJson(request.GeometryJson);

        if (string.IsNullOrEmpty(request.ExternalRef) || request.ExternalRef.Length > 80 || !IsValidExternalRef(request.ExternalRef))
        {
            throw new ValidationException("externalRef", "externalRef must be non-empty, at most 80 characters, and match the clu:/parcel:/drawn: form for its selection method.");
        }

        if (request.CalcAcres is not null && (request.CalcAcres <= 0 || request.CalcAcres >= 1_000_000))
        {
            throw new ValidationException("calcAcres", "calcAcres must be greater than 0 and less than 1,000,000.");
        }

        if (request.CdlYear is not null && !CdlYearPattern.IsMatch(request.CdlYear))
        {
            throw new ValidationException("cdlYear", "cdlYear must be a 4-digit year.");
        }

        if (request.CdlSnapshotJson is not null)
        {
            if (request.CdlSnapshotJson.Length > MaxCdlSnapshotJsonLength)
            {
                throw new ValidationException("cdlSnapshotJson", "cdlSnapshotJson exceeds the 256 KB size limit.");
            }
            ValidateCdlSnapshotJsonIsArray(request.CdlSnapshotJson);
        }
    }

    private static bool IsValidExternalRef(string externalRef) =>
        CluExternalRefPattern.IsMatch(externalRef)
        || ParcelExternalRefPattern.IsMatch(externalRef)
        || DrawnExternalRefPattern.IsMatch(externalRef);

    private static void ValidateGeometryJson(string geometryJson)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(geometryJson);
        }
        catch (JsonException)
        {
            throw new ValidationException("geometryJson", "geometryJson must be valid JSON.");
        }

        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("type", out var typeElement)
                || typeElement.ValueKind != JsonValueKind.String
                || (typeElement.GetString() != "Polygon" && typeElement.GetString() != "MultiPolygon"))
            {
                throw new ValidationException("geometryJson", "geometryJson's type must be Polygon or MultiPolygon.");
            }
        }
    }

    private static void ValidateCdlSnapshotJsonIsArray(string cdlSnapshotJson)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(cdlSnapshotJson);
        }
        catch (JsonException)
        {
            throw new ValidationException("cdlSnapshotJson", "cdlSnapshotJson must be valid JSON.");
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new ValidationException("cdlSnapshotJson", "cdlSnapshotJson must be a JSON array.");
            }
        }
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex) =>
        ex.InnerException is Microsoft.Data.Sqlite.SqliteException { SqliteErrorCode: 19 };
}
