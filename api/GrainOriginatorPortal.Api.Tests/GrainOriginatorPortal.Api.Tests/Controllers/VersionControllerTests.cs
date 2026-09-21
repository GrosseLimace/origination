// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;

// Third-party namespaces
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Covers the build-stamp endpoint the SPA shows in the profile menu.
/// </summary>
public class VersionControllerTests
{
    private readonly IHostEnvironment _environment = Substitute.For<IHostEnvironment>();
    private readonly VersionController _sut;

    public VersionControllerTests()
    {
        _environment.EnvironmentName.Returns("Development");
        _sut = new VersionController(_environment);
    }

    [Fact]
    public void Get_ReturnsTheCurrentReleaseFromTheNotesFile()
    {
        // Arrange
        var expected = WhatsNewController.Releases.Value.First();

        // Act
        var result = _sut.Get();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<VersionResponse>(okResult.Value);
        Assert.Equal(expected.Version, response.ReleaseVersion);
        Assert.Equal(expected.ReleasedOn, response.ReleasedOn);
    }

    [Fact]
    public void Get_ReportsTheBuildStampAndEnvironment()
    {
        // Outside CI nothing is stamped, so both read "local" — the assertion is that the values are
        // always populated, never blank.

        // Act
        var result = _sut.Get();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<VersionResponse>(okResult.Value);
        Assert.False(string.IsNullOrWhiteSpace(response.CommitSha));
        Assert.False(string.IsNullOrWhiteSpace(response.BuildNumber));
        Assert.Equal(BuildInfo.CommitSha, response.CommitSha);
        Assert.Equal(BuildInfo.BuildNumber, response.BuildNumber);
        Assert.Equal("Development", response.Environment);
    }

    [Fact]
    public void Get_ShortShaIsAPrefixOfTheFullSha()
    {
        // Act
        var result = _sut.Get();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<VersionResponse>(okResult.Value);
        Assert.StartsWith(response.ShortSha, response.CommitSha);
        Assert.True(response.ShortSha.Length <= 7);
    }
}
