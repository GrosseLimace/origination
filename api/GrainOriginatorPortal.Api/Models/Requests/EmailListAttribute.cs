using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// Validates a list of email addresses: bounds the number of entries and ensures each entry is
/// non-empty, within <see cref="MaxEmailLength"/> characters, and a syntactically valid email.
/// Data-annotation attributes on a <c>List&lt;string&gt;</c> property apply to the list, not its
/// elements, so this attribute enforces the per-item constraints while keeping the wire shape a
/// plain string array.
/// </summary>
[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]
public sealed class EmailListAttribute : ValidationAttribute
{
    /// <summary>Max length per email — matches the DailyRecapGroupCcEmails.Email column (256).</summary>
    public int MaxEmailLength { get; init; } = 256;

    /// <summary>Upper bound on the number of CC addresses to reject abusive payloads.</summary>
    public int MaxCount { get; init; } = 50;

    /// <summary>When set, every address must belong to this domain (case-insensitive, e.g. "scoular.com").
    /// Blocks forwarding recap content to arbitrary external mailboxes. Null = no domain restriction.</summary>
    public string? RequiredDomain { get; init; }

    private static readonly EmailAddressAttribute EmailValidator = new();

    protected override ValidationResult? IsValid(object? value, ValidationContext validationContext)
    {
        if (value is null) return ValidationResult.Success;

        if (value is not IEnumerable<string> emails)
            return new ValidationResult($"{validationContext.DisplayName} must be a list of email addresses.");

        var list = emails.ToList();
        if (list.Count > MaxCount)
            return new ValidationResult($"{validationContext.DisplayName} cannot contain more than {MaxCount} email addresses.");

        for (var i = 0; i < list.Count; i++)
        {
            var email = list[i];
            if (string.IsNullOrWhiteSpace(email))
                return new ValidationResult($"{validationContext.DisplayName}[{i}] must not be empty.");
            if (email.Length > MaxEmailLength)
                return new ValidationResult($"{validationContext.DisplayName}[{i}] must be {MaxEmailLength} characters or fewer.");
            if (!EmailValidator.IsValid(email))
                return new ValidationResult($"{validationContext.DisplayName}[{i}] is not a valid email address.");
            if (!string.IsNullOrEmpty(RequiredDomain)
                && !email.EndsWith($"@{RequiredDomain}", StringComparison.OrdinalIgnoreCase))
                return new ValidationResult($"{validationContext.DisplayName}[{i}] must be an @{RequiredDomain} address.");
        }

        return ValidationResult.Success;
    }
}
