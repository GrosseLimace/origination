// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Guards the shape of the ODS projection <see cref="CustomerTradeUnitView"/>
/// (originations.vw_CustomerTradeUnits).
///
/// Background: ODS removed IsActive / IsDeleted from the underlying data (2026-08) and now filters
/// inactive and deleted records out of the view itself. Because the entity is mapped with
/// <c>ToView</c>, EF selects every declared property by name — so a property the view doesn't have
/// fails the ENTIRE query with "Invalid column name", not just that column. That took down the whole
/// customer sync (dbo.Customer and dbo.CustomerTradeUnit stopped refreshing) and made
/// UserEntitlementService.ValidateCustomerAccessAsync throw.
///
/// These tests are cheap insurance against someone reintroducing that coupling.
/// </summary>
public class CustomerTradeUnitViewContractTests
{
    [Theory]
    [InlineData("IsActive")]
    [InlineData("IsDeleted")]
    public void DoesNotDeclareColumnsTheViewNoLongerHas(string removedColumn)
    {
        var property = typeof(CustomerTradeUnitView).GetProperty(removedColumn);

        Assert.Null(property);
    }

    [Fact]
    public void ToCustomerLeavesIsActiveToTheSyncsPresenceRule()
    {
        // The view can't tell us active/inactive any more — presence in it IS the signal, and
        // CustomerSyncService owns that decision (true on insert/reactivate, false when a row drops
        // out of the view). ToCustomer must therefore not assert an active state of its own.
        var view = new CustomerTradeUnitView { CustomerId = 1, CustomerName = "Test Producer" };

        var customer = view.ToCustomer();

        Assert.False(customer.IsActive);
    }

    [Fact]
    public void StillProjectsTheAttributesTheSyncCopies()
    {
        // The effective-date window survived the ODS change and is still copied by ApplyAttributes —
        // make sure trimming IsActive didn't take neighbouring fields with it.
        var view = new CustomerTradeUnitView
        {
            CustomerId = 42,
            CustomerName = "Test Producer",
            ScoularId = "ABCFARM",
            TradeUnit = "1085",
            EffectiveStartDate = new DateTime(2025, 1, 1),
            EffectiveEndDate = null,
        };

        var customer = view.ToCustomer();

        Assert.Equal(42, customer.Id);
        Assert.Equal("Test Producer", customer.Name);
        Assert.Equal("ABCFARM", customer.ScoularId);
        Assert.Equal(new DateTime(2025, 1, 1), customer.EffectiveStartDate);
        Assert.Null(customer.EffectiveEndDate);
    }

    [Fact]
    public void SharedOdsAttributeContractHasNoActiveFlag()
    {
        // ICustomerOdsAttributes is implemented by BOTH sync sources (this view and
        // base.vw_CurrentCustomers). Adding an active flag there would force it back onto this view.
        var names = typeof(ICustomerOdsAttributes).GetProperties().Select(p => p.Name).ToList();

        Assert.DoesNotContain("IsActive", names);
        Assert.DoesNotContain("IsDeleted", names);
    }
    [Theory]
    [InlineData("IndustryCode2")]
    [InlineData("NopIdNumber")]
    public void DeclaresTheOrganicColumnsOnBothSyncSources(string column)
    {
        // Added to originations.vw_CustomerTradeUnits on 2026-09-21 so the organic gate can read
        // them from the main sync pass rather than only for manually onboarded producers. Both
        // sources must carry them: ICustomerOdsAttributes is what ApplyAttributes copies from, so
        // a property here that one source lacks is the "Invalid column name" failure again.
        Assert.NotNull(typeof(CustomerTradeUnitView).GetProperty(column));
        Assert.NotNull(typeof(CurrentCustomerRow).GetProperty(column));
        Assert.NotNull(typeof(ICustomerOdsAttributes).GetProperty(column));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("0", null)]
    [InlineData(" 1234567890 ", "1234567890")]
    public void NormalisesThePlaceholderNopId(string? raw, string? expected)
    {
        // ODS holds the literal "0" on ~1,525 rows, far more than hold a real 10-digit id.
        // Letting that through would treat roughly three times the certified population as
        // having a NOPID on file.
        Assert.Equal(expected, OdsValues.NormaliseNopId(raw));
    }

}
