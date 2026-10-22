using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// The customer-level filters of <c>originations.vw_CustomerTradeUnits</c>, applied to a CTRM customer so
/// the CTRM sync source admits exactly the producers the ODS view does.
/// </summary>
public static class CtrmCustomerFilters
{
    public const string ProducerIndustryCode = "PR";

    /// <summary>
    /// Evaluates in a fixed order; <paramref name="reason"/> is one of "ok", "no-source-code", "inactive",
    /// "not-producer", "no-name", "name-dup", "name-do-not-use", "name-placeholder".
    /// </summary>
    /// <remarks>The name is checked raw (no trim before the first-character test), matching SQL <c>LEFT(name, 1)</c>.</remarks>
    public static bool IsInScope(CtrmCustomerDto dto, out string reason)
    {
        ArgumentNullException.ThrowIfNull(dto);

        if (string.IsNullOrWhiteSpace(dto.SourceCode))
        {
            reason = "no-source-code";
            return false;
        }

        if (!string.Equals(dto.ActiveYN?.Trim(), "Y", StringComparison.OrdinalIgnoreCase))
        {
            reason = "inactive";
            return false;
        }

        if (!string.Equals(dto.IndustryCode1?.Trim(), ProducerIndustryCode, StringComparison.OrdinalIgnoreCase))
        {
            reason = "not-producer";
            return false;
        }

        var name = dto.Name;
        if (name is null)
        {
            reason = "no-name";
            return false;
        }

        if (name.Contains("DUP", StringComparison.OrdinalIgnoreCase))
        {
            reason = "name-dup";
            return false;
        }

        if (name.Contains("DO NOT USE", StringComparison.OrdinalIgnoreCase))
        {
            reason = "name-do-not-use";
            return false;
        }

        if (name.Length > 0 && (name[0] == '*' || name[0] == '$'))
        {
            reason = "name-placeholder";
            return false;
        }

        reason = "ok";
        return true;
    }
}
