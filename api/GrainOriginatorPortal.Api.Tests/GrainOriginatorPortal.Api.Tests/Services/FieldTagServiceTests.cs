// Third-party namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Unit tests for <see cref="FieldTagService"/>, the POC field-tagging service (see
/// docs/maps/field-tagging/02-backend-api.md). Covers request validation (SelectionMethod,
/// ExternalRef pattern matching per selection method), duplicate-ExternalRef 409 detection,
/// apply-calculated-acres summation/rounding/zero-tags 409, and the "dormant feature" path when
/// <see cref="IFieldTagRepository"/> is not registered in the container (config-gated, per
/// FieldTagsPocDependencyInjection) — the service must resolve it as an optional dependency via
/// <see cref="IServiceProvider.GetService(Type)"/> rather than requiring it.
/// </summary>
public class FieldTagServiceTests
{
    private const long CustomerId = 42L;

    private readonly Mock<IFieldTagRepository> _fieldTagRepo = new();
    private readonly Mock<ICustomerRepository> _customerRepo = new();
    private readonly Mock<IProducerDetailsRepository> _producerDetailsRepo = new();
    private readonly Mock<IRequestContextService> _requestContext = new();

    public FieldTagServiceTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns("originator@scoular.com");
        _customerRepo.Setup(r => r.GetByIdAsync(CustomerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Customer { Id = CustomerId, Name = "Test Producer" });
    }

    /// <summary>Builds a service with the field-tag repository registered (feature enabled) —
    /// the "active" path, wiring the mock through IServiceProvider.GetService like the real DI
    /// container does when FieldTags:LocalStorePath is configured.</summary>
    private FieldTagService CreateEnabledService()
    {
        var serviceProvider = new Mock<IServiceProvider>();
        serviceProvider.Setup(sp => sp.GetService(typeof(IFieldTagRepository))).Returns(_fieldTagRepo.Object);

        return new FieldTagService(
            serviceProvider.Object,
            _customerRepo.Object,
            _producerDetailsRepo.Object,
            _requestContext.Object,
            Mock.Of<ILogger<FieldTagService>>());
    }

    /// <summary>Builds a service with no field-tag repository registered — the "dormant feature"
    /// path (config absent), which every mutation must reject with FIELD_TAGS_DISABLED and every
    /// read must answer with an empty result rather than throwing.</summary>
    private FieldTagService CreateDormantService()
    {
        var serviceProvider = new Mock<IServiceProvider>();
        serviceProvider.Setup(sp => sp.GetService(typeof(IFieldTagRepository))).Returns((object?)null);

        return new FieldTagService(
            serviceProvider.Object,
            _customerRepo.Object,
            _producerDetailsRepo.Object,
            _requestContext.Object,
            Mock.Of<ILogger<FieldTagService>>());
    }

    private static CreateFieldTagRequest ValidRequest(
        string selectionMethod = "clu",
        string externalRef = "clu:12345",
        string geometryJson = "{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[0,1],[1,1],[0,0]]]}") => new()
    {
        SelectionMethod = selectionMethod,
        GeometryJson = geometryJson,
        CalcAcres = 123.4m,
        ExternalRef = externalRef,
        CdlYear = "2024",
        CdlSnapshotJson = "[]",
    };

    // =========================================================================================
    // Dormant-feature path (IFieldTagRepository not registered)
    // =========================================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomerAsync_RepositoryNotRegistered_ReturnsEmptyList()
    {
        var sut = CreateDormantService();

        var result = await sut.GetByCustomerAsync(CustomerId, CancellationToken.None);

        Assert.Empty(result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_RepositoryNotRegistered_ThrowsDisabledBusinessException()
    {
        var sut = CreateDormantService();

        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            sut.CreateAsync(CustomerId, ValidRequest(), CancellationToken.None));

        Assert.Equal("FIELD_TAGS_DISABLED", ex.ErrorCode);
        Assert.Equal(StatusCodes.Status409Conflict, ex.HttpStatusCode);
        _customerRepo.Verify(r => r.GetByIdAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DeleteAsync_RepositoryNotRegistered_ThrowsDisabledBusinessException()
    {
        var sut = CreateDormantService();

        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            sut.DeleteAsync(CustomerId, 1, CancellationToken.None));

        Assert.Equal("FIELD_TAGS_DISABLED", ex.ErrorCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyCalculatedAcresAsync_RepositoryNotRegistered_ThrowsDisabledBusinessException()
    {
        var sut = CreateDormantService();

        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            sut.ApplyCalculatedAcresAsync(CustomerId, CancellationToken.None));

        Assert.Equal("FIELD_TAGS_DISABLED", ex.ErrorCode);
        _producerDetailsRepo.Verify(
            r => r.UpdateTotalAcresAsync(It.IsAny<long>(), It.IsAny<decimal>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    // =========================================================================================
    // Validation: SelectionMethod
    // =========================================================================================

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("clu")]
    [InlineData("parcel")]
    [InlineData("drawn")]
    public async Task CreateAsync_ValidSelectionMethod_DoesNotThrowValidationException(string method)
    {
        var sut = CreateEnabledService();
        var externalRef = method switch
        {
            "clu" => "clu:1",
            "parcel" => "parcel:abc-123",
            _ => "drawn:" + new string('a', 64),
        };
        _fieldTagRepo.Setup(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomerFieldTag t, CancellationToken _) => t);

        var ex = await Record.ExceptionAsync(() =>
            sut.CreateAsync(CustomerId, ValidRequest(method, externalRef), CancellationToken.None));

        Assert.Null(ex);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("")]
    [InlineData("shapefile")]
    [InlineData("CLU")] // case-sensitive — not one of the lowercase literals
    public async Task CreateAsync_InvalidSelectionMethod_ThrowsValidationException(string method)
    {
        var sut = CreateEnabledService();

        var ex = await Assert.ThrowsAsync<ValidationException>(() =>
            sut.CreateAsync(CustomerId, ValidRequest(method, "clu:1"), CancellationToken.None));

        Assert.True(ex.Errors.ContainsKey("selectionMethod"));
        _fieldTagRepo.Verify(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // =========================================================================================
    // Validation: ExternalRef pattern per selection method
    // =========================================================================================

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("clu:123456")]
    [InlineData("parcel:some-vendor-id")]
    public async Task CreateAsync_ExternalRefMatchingSomeMethodPattern_DoesNotThrowValidationException(string externalRef)
    {
        // The service's IsValidExternalRef check accepts any of the three patterns regardless of
        // the declared SelectionMethod — it does not cross-check method-to-prefix consistency, so
        // this asserts the documented regex-matching behavior itself, not a method/prefix pairing.
        var sut = CreateEnabledService();
        _fieldTagRepo.Setup(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomerFieldTag t, CancellationToken _) => t);

        var ex = await Record.ExceptionAsync(() =>
            sut.CreateAsync(CustomerId, ValidRequest(externalRef: externalRef), CancellationToken.None));

        Assert.Null(ex);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("clu:")] // no digits
    [InlineData("clu:abc")] // non-numeric
    [InlineData("drawn:notahexhash")] // wrong shape for the 64-char sha256 pattern
    [InlineData("unknown:123")] // unrecognized prefix
    [InlineData("")] // empty
    public async Task CreateAsync_ExternalRefNotMatchingAnyMethodPattern_ThrowsValidationException(string externalRef)
    {
        var sut = CreateEnabledService();

        var ex = await Assert.ThrowsAsync<ValidationException>(() =>
            sut.CreateAsync(CustomerId, ValidRequest(externalRef: externalRef), CancellationToken.None));

        Assert.True(ex.Errors.ContainsKey("externalRef"));
        _fieldTagRepo.Verify(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_DrawnExternalRefWithValidSha256Shape_DoesNotThrowValidationException()
    {
        var sut = CreateEnabledService();
        var externalRef = "drawn:" + new string('a', 64);
        _fieldTagRepo.Setup(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomerFieldTag t, CancellationToken _) => t);

        var ex = await Record.ExceptionAsync(() =>
            sut.CreateAsync(CustomerId, ValidRequest("drawn", externalRef), CancellationToken.None));

        Assert.Null(ex);
    }

    // =========================================================================================
    // Duplicate detection
    // =========================================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_ActiveDuplicateExternalRefExists_ThrowsConflictBusinessException()
    {
        var sut = CreateEnabledService();
        _fieldTagRepo.Setup(r => r.GetActiveByExternalRefAsync(CustomerId, "clu:12345", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CustomerFieldTag { Id = 1, CustomerId = CustomerId, ExternalRef = "clu:12345" });

        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            sut.CreateAsync(CustomerId, ValidRequest(externalRef: "clu:12345"), CancellationToken.None));

        Assert.Equal("FIELD_TAG_DUPLICATE", ex.ErrorCode);
        Assert.Equal(StatusCodes.Status409Conflict, ex.HttpStatusCode);
        _fieldTagRepo.Verify(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_NoActiveDuplicate_PersistsAndReturnsResponse()
    {
        var sut = CreateEnabledService();
        _fieldTagRepo.Setup(r => r.GetActiveByExternalRefAsync(CustomerId, "clu:12345", It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomerFieldTag?)null);
        _fieldTagRepo.Setup(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomerFieldTag t, CancellationToken _) => { t.Id = 7; return t; });

        var response = await sut.CreateAsync(CustomerId, ValidRequest(externalRef: "clu:12345"), CancellationToken.None);

        Assert.Equal(7, response.Id);
        Assert.Equal("clu:12345", response.ExternalRef);
        _fieldTagRepo.Verify(r => r.AddAsync(It.IsAny<CustomerFieldTag>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // =========================================================================================
    // apply-calculated-acres
    // =========================================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyCalculatedAcresAsync_ZeroActiveTags_ThrowsEmptyBusinessException()
    {
        var sut = CreateEnabledService();
        _fieldTagRepo.Setup(r => r.GetByCustomerAsync(CustomerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            sut.ApplyCalculatedAcresAsync(CustomerId, CancellationToken.None));

        Assert.Equal("FIELD_TAGS_EMPTY", ex.ErrorCode);
        Assert.Equal(StatusCodes.Status409Conflict, ex.HttpStatusCode);
        _producerDetailsRepo.Verify(
            r => r.UpdateTotalAcresAsync(It.IsAny<long>(), It.IsAny<decimal>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyCalculatedAcresAsync_SumsActiveTagsAndRoundsToOneDecimal()
    {
        var sut = CreateEnabledService();
        _fieldTagRepo.Setup(r => r.GetByCustomerAsync(CustomerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(
            [
                new CustomerFieldTag { Id = 1, CustomerId = CustomerId, CalcAcres = 123.44m },
                new CustomerFieldTag { Id = 2, CustomerId = CustomerId, CalcAcres = 56.78m },
                new CustomerFieldTag { Id = 3, CustomerId = CustomerId, CalcAcres = null }, // contributes 0
            ]);
        _producerDetailsRepo
            .Setup(r => r.UpdateTotalAcresAsync(CustomerId, 180.2m, "originator@scoular.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ProducerDetails { CustomerId = CustomerId, TotalAcres = 180.2m });

        var result = await sut.ApplyCalculatedAcresAsync(CustomerId, CancellationToken.None);

        // 123.44 + 56.78 + 0 = 180.22 -> rounds to 180.2
        Assert.Equal(180.2m, result.TotalAcres);
        Assert.Equal(3, result.TagCount);
        Assert.Equal(CustomerId, result.CustomerId);
        _producerDetailsRepo.Verify(
            r => r.UpdateTotalAcresAsync(CustomerId, 180.2m, "originator@scoular.com", It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyCalculatedAcresAsync_RoundsMidpointAwayFromZero()
    {
        var sut = CreateEnabledService();
        _fieldTagRepo.Setup(r => r.GetByCustomerAsync(CustomerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(
            [
                new CustomerFieldTag { Id = 1, CustomerId = CustomerId, CalcAcres = 10.05m },
            ]);
        _producerDetailsRepo
            .Setup(r => r.UpdateTotalAcresAsync(CustomerId, It.IsAny<decimal>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ProducerDetails { CustomerId = CustomerId });

        var result = await sut.ApplyCalculatedAcresAsync(CustomerId, CancellationToken.None);

        Assert.Equal(10.1m, result.TotalAcres);
    }
}
