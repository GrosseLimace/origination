// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Mapping;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// The phone's Overview shows the producer's own phone and email exactly as the desktop profile does
/// (customer-profile getCustomerPhone/getCustomerEmail), always, alongside any entered contacts (2026-10-14).
/// </summary>
public class MobileCustomerDetailMappingTests
{
    [Fact]
    public void PhoneAndEmail_UseTheMasterDataFields_FirstChoiceFirst()
    {
        var dto = new CustomerResponse { Id = 1, Name = "P", Phone = "402-555-0100", ExtendedPrimaryPhone = "402-555-0199", Email = "a@x.com", SupplementalEmail = "b@x.com" }
            .ToDetail([], tradeUnit: null);

        Assert.Equal("402-555-0100", dto.Phone);
        Assert.Equal("a@x.com", dto.Email);
    }

    [Fact]
    public void PhoneAndEmail_FallBack_WhenTheFirstChoiceIsBlank()
    {
        var dto = new CustomerResponse { Id = 1, Name = "P", Phone = " ", ExtendedPrimaryPhone = "402-555-0199", Email = null, SupplementalEmail = "b@x.com" }
            .ToDetail([], tradeUnit: null);

        Assert.Equal("402-555-0199", dto.Phone);
        Assert.Equal("b@x.com", dto.Email);
    }

    [Fact]
    public void EnteredContacts_DoNotReplaceTheProducersOwnPhoneAndEmail()
    {
        var dto = new CustomerResponse { Id = 1, Name = "P", Phone = "402-555-0100", Email = "a@x.com" }
            .ToDetail([new ContactDto { Name = "Pat", Phone = "402-555-0111", IsPrimary = true }], tradeUnit: null);

        Assert.Equal("402-555-0100", dto.Phone);
        Assert.Equal("a@x.com", dto.Email);
        Assert.Equal("Pat", Assert.Single(dto.Contacts).Name);
    }
}
