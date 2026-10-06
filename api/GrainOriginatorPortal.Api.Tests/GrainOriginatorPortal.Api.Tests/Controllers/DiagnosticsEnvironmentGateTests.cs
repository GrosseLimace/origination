// Microsoft namespaces
using Microsoft.AspNetCore.Hosting;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The ONE definition of "production-like" shared by every diagnostics controller: local Development and the
/// deployed Dev and QA App Services are open; every other environment name (PROD, staging, a blank or a
/// misspelled one) is closed.
/// </summary>
public class DiagnosticsEnvironmentGateTests
{
    [Theory]
    [InlineData("Development", false)]
    [InlineData("Dev", false)]
    [InlineData("QA", false)]
    [InlineData("Production", true)]
    [InlineData("Staging", true)]
    [InlineData("", true)]
    public void IsProductionLike_OnlyTheThreeNonProdNamesAreOpen(string environmentName, bool expected)
    {
        var env = new Mock<IWebHostEnvironment>();
        env.Setup(e => e.EnvironmentName).Returns(environmentName);

        Assert.Equal(expected, DiagnosticsEnvironmentGate.IsProductionLike(env.Object));
    }
}
