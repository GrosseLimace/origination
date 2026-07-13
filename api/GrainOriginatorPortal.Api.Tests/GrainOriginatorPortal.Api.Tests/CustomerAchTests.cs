using GrainOriginatorPortal.Infrastructure.Repositories;
using Xunit;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Verifies the ACH-enabled rule: a producer is ACH-enabled iff base.Customer.PaymentMethod is 'H'.
/// Drives the blue "ACH Enabled" pill on the producer profile.
/// </summary>
public class CustomerAchTests
{
    [Theory]
    [InlineData("H")]
    [InlineData("h")]
    [InlineData(" H ")]  // ODS CHAR-padding tolerated
    public void PaymentMethodH_IsAch(string paymentMethod)
    {
        Assert.True(CustomerRepository.IsAchPaymentMethod(paymentMethod));
    }

    [Theory]
    [InlineData("C")]
    [InlineData("HH")]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData(null)]
    public void OtherOrEmpty_IsNotAch(string? paymentMethod)
    {
        Assert.False(CustomerRepository.IsAchPaymentMethod(paymentMethod));
    }
}
