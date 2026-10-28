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

    // -------------------------------------------------------------------------------------------------
    // E1: extended mode (CustomerSync:CtrmExtendedFields) — the GraphQL fields that arrived on 2026-10-06

    private static CtrmCustomerDto ExtendedDto(string nopidJson = "\" 1234567890 \"") => new()
    {
        Name = "N", SourceCode = "S", MerchandisingPhone = "P", MerchandisingCity = "C", MerchandisingStateProvince = "ST",
        MerchandisingAddressLine1 = "A", MerchandisingPostalCode = "Z", IndustryCode1 = "PR", IndustryCode2 = "OR",
        MerchandisingEmail = " a@b.com ",
        SupplementalEmail = " c@d.com ",
        ExtendedPrimaryPhone = " 402-555-0101 ",
        ExtendedAddressLine1 = " x1 ",
        ExtendedAddressLine2 = " x2 ",
        ExtendedAddressLine3 = " x3 ",
        ExtendedAddressLine4 = " x4 ",
        ExtendedCity = " xc ",
        ExtendedStateProvince = " xs ",
        ExtendedPostalCode = " xp ",
        ExtendedCountry = " US ",
        NopidNo = System.Text.Json.JsonDocument.Parse(nopidJson).RootElement.Clone(),
        PaymentMethod = " H ",
    };

    // E2: the payment method rides on the extended projection and feeds the ACH badge on the ctrm source.

    [Fact]
    public void Ctrm_Extended_ApplyTo_SetsPaymentMethod_Trimmed()
    {
        var target = new Customer();

        new CtrmCustomerSyncAttributes(ExtendedDto(), extended: true).ApplyTo(target);

        Assert.Equal("H", target.PaymentMethod);
    }

    [Theory]
    [InlineData("  ", null)]
    [InlineData(null, null)]
    [InlineData("0123456789", "0123456789")]
    [InlineData("01234567890", null)]   // longer than nvarchar(10): never 'H', and must not fail the sync's SaveChanges
    public void Ctrm_Extended_ApplyTo_PaymentMethod_BlankOrTooLongIsNull(string? value, string? expected)
    {
        var target = new Customer { PaymentMethod = "old" };
        var dto = ExtendedDto();
        dto.PaymentMethod = value;

        new CtrmCustomerSyncAttributes(dto, extended: true).ApplyTo(target);

        Assert.Equal(expected, target.PaymentMethod);
    }

    [Fact]
    public void Ctrm_NotExtended_LeavesPaymentMethodUntouched()
    {
        var target = new Customer { PaymentMethod = "keep" };

        new CtrmCustomerSyncAttributes(ExtendedDto(), extended: false).ApplyTo(target);

        Assert.Equal("keep", target.PaymentMethod);
    }

    [Fact]
    public void Ods_ApplyTo_NeverWritesPaymentMethod()
    {
        // The ods source reads ACH live from base.Customer; dbo.Customer.PaymentMethod is a ctrm-only column.
        var target = new Customer { PaymentMethod = "keep" };

        new OdsCustomerSyncAttributes(FullView()).ApplyTo(target);

        Assert.Equal("keep", target.PaymentMethod);
    }

    [Fact]
    public void Ctrm_Extended_ApplyTo_SetsEmailPhonesExtendedAddressAndNopId_Trimmed()
    {
        var target = new Customer();

        new CtrmCustomerSyncAttributes(ExtendedDto(), extended: true).ApplyTo(target);

        Assert.Equal("a@b.com", target.Email);
        Assert.Equal("c@d.com", target.SupplementalEmail);
        Assert.Equal("402-555-0101", target.ExtendedPrimaryPhone);
        Assert.Equal("x1", target.ExtendedAddressLine1);
        Assert.Equal("x2", target.ExtendedAddressLine2);
        Assert.Equal("x3", target.ExtendedAddressLine3);
        Assert.Equal("x4", target.ExtendedAddressLine4);
        Assert.Equal("xc", target.ExtendedCity);
        Assert.Equal("xs", target.ExtendedStateProvince);
        Assert.Equal("xp", target.ExtendedPostalCode);
        Assert.Equal("US", target.ExtendedCountry);
        Assert.Equal("1234567890", target.NopIdNumber);
        // ...and still the nine Stage 1 columns.
        Assert.Equal("N", target.Name);
        Assert.Equal("S", target.ScoularId);
    }

    [Theory]
    [InlineData("\"0\"")]
    [InlineData("\"9999999999\"")]
    [InlineData("0")]
    [InlineData("null")]
    public void Ctrm_Extended_ApplyTo_NormalisesAPlaceholderNopIdToNull_LikeTheOdsApplier(string nopidJson)
    {
        var target = new Customer { NopIdNumber = "1234567890" };

        new CtrmCustomerSyncAttributes(ExtendedDto(nopidJson), extended: true).ApplyTo(target);

        Assert.Null(target.NopIdNumber);
    }

    [Fact]
    public void Ctrm_Extended_ApplyTo_BlankExtendedValuesBecomeNull()
    {
        var target = new Customer { Email = "old", ExtendedCity = "old" };
        var dto = ExtendedDto();
        dto.MerchandisingEmail = "  ";
        dto.ExtendedCity = null;

        new CtrmCustomerSyncAttributes(dto, extended: true).ApplyTo(target);

        Assert.Null(target.Email);
        Assert.Null(target.ExtendedCity);
    }

    [Fact]
    public void Ctrm_NotExtended_IgnoresExtendedValuesEvenWhenTheDtoCarriesThem()
    {
        var target = new Customer { Email = "keep", ExtendedCity = "keep", NopIdNumber = "keep" };

        new CtrmCustomerSyncAttributes(ExtendedDto(), extended: false).ApplyTo(target);

        Assert.Equal("keep", target.Email);
        Assert.Equal("keep", target.ExtendedCity);
        Assert.Equal("keep", target.NopIdNumber);
    }

    [Fact]
    public void Ctrm_UntouchedColumnsFor_IsTheStage1ListOff_AndOnlyTheEffectiveDatesOn()
    {
        Assert.Equal(CtrmCustomerSyncAttributes.UntouchedColumns, CtrmCustomerSyncAttributes.UntouchedColumnsFor(extended: false));
        Assert.Equal(["EffectiveStartDate", "EffectiveEndDate"], CtrmCustomerSyncAttributes.UntouchedColumnsFor(extended: true));
    }

    [Fact]
    public void Ctrm_Extended_LeavesOnlyTheEffectiveDatesUntouched_OfEveryColumnTheOdsApplierSets()
    {
        // Every column the ODS applier sets, minus the ones extended CTRM sets, is exactly the untouched list.
        var view = FullView();
        view.NopIdNumber = "1234567890";
        var odsApplied = new Customer();
        new OdsCustomerSyncAttributes(view).ApplyTo(odsApplied);
        var blank = new Customer();
        var ctrmApplied = new Customer();
        new CtrmCustomerSyncAttributes(ExtendedDto(), extended: true).ApplyTo(ctrmApplied);

        var odsSets = typeof(Customer).GetProperties().Where(IsSimple)
            .Where(p => !Equals(p.GetValue(blank), p.GetValue(odsApplied))).Select(p => p.Name).ToHashSet();
        var ctrmSets = typeof(Customer).GetProperties().Where(IsSimple)
            .Where(p => !Equals(p.GetValue(blank), p.GetValue(ctrmApplied))).Select(p => p.Name).ToHashSet();

        Assert.True(
            odsSets.Except(ctrmSets).ToHashSet().SetEquals(CtrmCustomerSyncAttributes.UntouchedColumnsFor(extended: true)),
            "ODS-set columns extended CTRM does not set: " + string.Join(", ", odsSets.Except(ctrmSets)));

        // And the effective dates really are left alone.
        var target = new Customer { EffectiveStartDate = new DateTime(2020, 1, 1), EffectiveEndDate = new DateTime(2021, 1, 1) };
        new CtrmCustomerSyncAttributes(ExtendedDto(), extended: true).ApplyTo(target);
        Assert.Equal(new DateTime(2020, 1, 1), target.EffectiveStartDate);
        Assert.Equal(new DateTime(2021, 1, 1), target.EffectiveEndDate);
    }
}
