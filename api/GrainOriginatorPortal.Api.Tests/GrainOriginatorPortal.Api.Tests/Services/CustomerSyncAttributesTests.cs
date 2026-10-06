// System namespaces
using System.Reflection;

// Third-party namespaces
using Xunit;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class CustomerSyncAttributesTests
{
    private static readonly string[] NineMapped =
        ["Name", "ScoularId", "Phone", "Location", "StateProvince", "AddressLine1", "PostalCode", "IndustryCode1", "IndustryCode2"];

    private static CustomerTradeUnitView FullView() => new()
    {
        CustomerId = 77,
        CustomerName = "Smith Farms",
        ScoularId = "SMITFAR",
        MerchandisingPhone = "402-555-0100",
        MerchandisingEmail = "a@b.com",
        ExtendedPrimaryPhone = "402-555-0101",
        SupplementalEmail = "c@d.com",
        MerchandisingCity = "Omaha",
        MerchandisingStateProvince = "NE",
        MerchandisingAddressLine1 = "1 Main",
        MerchandisingPostalCode = "68102",
        ExtendedAddressLine1 = "x1",
        ExtendedAddressLine2 = "x2",
        ExtendedAddressLine3 = "x3",
        ExtendedAddressLine4 = "x4",
        ExtendedCity = "xc",
        ExtendedStateProvince = "xs",
        ExtendedPostalCode = "xp",
        ExtendedCountry = "US",
        IndustryCode1 = "PR",
        IndustryCode2 = "OR",
        NopIdNumber = "0",
        EffectiveStartDate = new DateTime(2020, 1, 2),
        EffectiveEndDate = new DateTime(2030, 3, 4),
        TradeUnit = "1085",
    };

    private static bool IsSimple(PropertyInfo p)
    {
        var t = Nullable.GetUnderlyingType(p.PropertyType) ?? p.PropertyType;
        return p.CanRead && p.CanWrite && (t == typeof(string) || t == typeof(DateTime) || t == typeof(bool) || t == typeof(long) || t == typeof(int));
    }

    [Fact]
    public void Ods_ApplyTo_CopiesEveryViewColumn_AndNormalisesNopId()
    {
        var view = FullView();
        var target = new Customer { Id = view.CustomerId };

        new OdsCustomerSyncAttributes(view).ApplyTo(target);

        Assert.Null(target.NopIdNumber);
        var expected = view.ToCustomer();
        foreach (var property in typeof(Customer).GetProperties().Where(IsSimple).Where(p => p.Name != nameof(Customer.IsActive)))
        {
            Assert.True(
                Equals(property.GetValue(expected), property.GetValue(target)),
                $"{property.Name} differs from ToCustomer()");
        }
        Assert.Equal("Smith Farms", target.Name);
        Assert.Equal(new DateTime(2030, 3, 4), target.EffectiveEndDate);
        Assert.Equal("US", target.ExtendedCountry);
    }

    [Fact]
    public void Ods_ApplyTo_KeepsARealNopId()
    {
        var view = FullView();
        view.NopIdNumber = "1234567890";
        var target = new Customer();

        new OdsCustomerSyncAttributes(view).ApplyTo(target);

        Assert.Equal("1234567890", target.NopIdNumber);
    }

    [Fact]
    public void Ctrm_ApplyTo_SetsTheNineStage1Columns_Trimmed()
    {
        var dto = new CtrmCustomerDto
        {
            Name = " Smith Farms ",
            SourceCode = "SMITFAR ",
            MerchandisingPhone = " 402 ",
            MerchandisingCity = " Omaha ",
            MerchandisingStateProvince = " NE ",
            MerchandisingAddressLine1 = " 1 Main ",
            MerchandisingPostalCode = " 68102 ",
            IndustryCode1 = " PR ",
            IndustryCode2 = " OR ",
        };
        var target = new Customer();

        new CtrmCustomerSyncAttributes(dto).ApplyTo(target);

        Assert.Equal("Smith Farms", target.Name);
        Assert.Equal("SMITFAR", target.ScoularId);
        Assert.Equal("402", target.Phone);
        Assert.Equal("Omaha", target.Location);
        Assert.Equal("NE", target.StateProvince);
        Assert.Equal("1 Main", target.AddressLine1);
        Assert.Equal("68102", target.PostalCode);
        Assert.Equal("PR", target.IndustryCode1);
        Assert.Equal("OR", target.IndustryCode2);
    }

    [Fact]
    public void Ctrm_ApplyTo_BlankValuesBecomeNull_AndNameFallsBackToEmpty()
    {
        var target = new Customer { Name = "old", Phone = "old" };

        new CtrmCustomerSyncAttributes(new CtrmCustomerDto { Name = "  ", MerchandisingPhone = "" }).ApplyTo(target);

        Assert.Equal(string.Empty, target.Name);
        Assert.Null(target.Phone);
    }

    [Fact]
    public void Ctrm_ApplyTo_LeavesColumnsWithoutAGraphQlFieldUntouched()
    {
        var target = new Customer { EffectiveStartDate = new DateTime(2020, 1, 1), EffectiveEndDate = new DateTime(2021, 1, 1) };
        foreach (var property in typeof(Customer).GetProperties().Where(IsSimple).Where(p => p.PropertyType == typeof(string)))
        {
            property.SetValue(target, "keep");
        }
        var dto = new CtrmCustomerDto { Name = "N", SourceCode = "S", MerchandisingPhone = "P", MerchandisingCity = "C", MerchandisingStateProvince = "ST", MerchandisingAddressLine1 = "A", MerchandisingPostalCode = "Z", IndustryCode1 = "PR", IndustryCode2 = "OR" };

        new CtrmCustomerSyncAttributes(dto).ApplyTo(target);

        foreach (var name in CtrmCustomerSyncAttributes.UntouchedColumns)
        {
            var value = typeof(Customer).GetProperty(name)!.GetValue(target);
            var expected = name == "EffectiveStartDate" ? (object)new DateTime(2020, 1, 1)
                : name == "EffectiveEndDate" ? new DateTime(2021, 1, 1)
                : "keep";
            Assert.Equal(expected, value);
        }
    }

    [Fact]
    public void Ctrm_UntouchedColumns_CoverEveryCustomerColumnTheOdsApplierSets_MinusTheNineMapped()
    {
        var blank = new Customer();
        // NopIdNumber normalises "0" to null, so use a real id to see the column change.
        var view = FullView();
        view.NopIdNumber = "1234567890";
        var applied = new Customer();
        new OdsCustomerSyncAttributes(view).ApplyTo(applied);

        var changed = typeof(Customer).GetProperties().Where(IsSimple)
            .Where(p => !Equals(p.GetValue(blank), p.GetValue(applied)))
            .Select(p => p.Name)
            .Except(NineMapped)
            .ToHashSet();

        Assert.True(changed.SetEquals(CtrmCustomerSyncAttributes.UntouchedColumns));
    }

    [Fact]
    public void CreateNew_SetsIdActiveAndNotManual()
    {
        var created = new CtrmCustomerSyncAttributes(new CtrmCustomerDto { Name = "N", SourceCode = "S" }).CreateNew(5_000_000_000_000_001);

        Assert.Equal(5_000_000_000_000_001, created.Id);
        Assert.True(created.IsActive);
        Assert.False(created.IsManual);
        Assert.Equal("N", created.Name);
        Assert.Equal("S", created.ScoularId);
    }
}
