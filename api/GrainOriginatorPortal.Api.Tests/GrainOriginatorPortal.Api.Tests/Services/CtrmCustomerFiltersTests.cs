// Third-party namespaces
using Xunit;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class CtrmCustomerFiltersTests
{
    [Theory]
    [InlineData("Y", "PR", "Smith Farms", "SMITFAR", true, "ok")]
    [InlineData("N", "PR", "Smith Farms", "SMITFAR", false, "inactive")]
    [InlineData("Y", "CM", "Smith Farms", "SMITFAR", false, "not-producer")]
    [InlineData("Y", " pr ", "Smith Farms", "SMITFAR", true, "ok")]
    [InlineData("Y", "PR", "SMITH DUP", "X", false, "name-dup")]
    [InlineData("Y", "PR", "do not use - smith", "X", false, "name-do-not-use")]
    [InlineData("Y", "PR", "*Smith", "X", false, "name-placeholder")]
    [InlineData("Y", "PR", "$Smith", "X", false, "name-placeholder")]
    [InlineData("Y", "PR", null, "X", false, "no-name")]
    [InlineData("Y", "PR", "Smith", "", false, "no-source-code")]
    [InlineData("y", "PR", "Smith", "X", true, "ok")]
    public void IsInScope_AppliesTheViewFilters(string? activeYn, string? industryCode1, string? name, string? sourceCode, bool expectedInScope, string expectedReason)
    {
        var dto = new CtrmCustomerDto { ActiveYN = activeYn, IndustryCode1 = industryCode1, Name = name, SourceCode = sourceCode };

        var result = CtrmCustomerFilters.IsInScope(dto, out var reason);

        Assert.Equal(expectedInScope, result);
        Assert.Equal(expectedReason, reason);
    }

    [Fact]
    public void IsInScope_ChecksSourceCodeFirst()
    {
        var dto = new CtrmCustomerDto { ActiveYN = "N", IndustryCode1 = "CM", Name = null, SourceCode = null };

        Assert.False(CtrmCustomerFilters.IsInScope(dto, out var reason));
        Assert.Equal("no-source-code", reason);
    }

    [Fact]
    public void IsInScope_LeadingSpaceBeforeStarIsNotAPlaceholder()
    {
        // SQL LEFT(name, 1) is checked on the raw value, so " *Smith" starts with a space.
        var dto = new CtrmCustomerDto { ActiveYN = "Y", IndustryCode1 = "PR", Name = " *Smith", SourceCode = "X" };

        Assert.True(CtrmCustomerFilters.IsInScope(dto, out var reason));
        Assert.Equal("ok", reason);
    }
}
