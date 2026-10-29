namespace GrainOriginatorPortal.Api.Services;

/// <summary>Caller-id phone number normalization for matching against stored numbers.</summary>
public static class PhoneDigits
{
    /// <summary>Reduces a raw caller id to digits for matching: strips all non-digits and a
    /// US "+1" country code (11 digits starting with 1 → last 10). Returns null when fewer
    /// than 7 digits remain — too short to be a meaningful phone match.</summary>
    public static string? Normalize(string? rawNumber)
    {
        if (string.IsNullOrWhiteSpace(rawNumber))
            return null;

        var digits = new string(rawNumber.Where(char.IsDigit).ToArray());
        if (digits.Length == 11 && digits[0] == '1')
            digits = digits[1..];

        return digits.Length >= 7 ? digits : null;
    }
}
