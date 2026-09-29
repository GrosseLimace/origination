using System.Text;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Derives stable surrogate ids for CTRM-origin records, which have natural keys only.
/// </summary>
/// <remarks>
/// <para>Our entities carry <c>long</c> primary keys taken from ODS surrogate columns
/// (<c>ContractId</c>, <c>TicketId</c>), and the Angular client dedupes contracts on
/// <c>Contract.id</c> alone. CTRM has no equivalent — a contract is identified by its
/// <c>contractId</c> string and a ticket by a five-part composite key — so an id has to be
/// manufactured, and it has to be stable across requests or the client would treat the same
/// contract as new on every poll.</para>
///
/// <para>Two constraints shape the implementation:</para>
///
/// <para><b>It must not collide with a real ODS id.</b> The feature flag is per-method, so a screen
/// can hold ODS-sourced and CTRM-sourced rows at the same time. The ranges are kept disjoint by
/// offsetting every synthetic id into a reserved band well above any ODS value.</para>
///
/// <para><b>It must survive the trip through JavaScript.</b> <c>Contract.id</c> is a TypeScript
/// <c>number</c>, i.e. an IEEE-754 double, which represents integers exactly only up to 2^53 − 1. A
/// full 64-bit hash would be silently rounded in the browser and could collapse two distinct
/// contracts onto one id — and that id is the dedup key — so the band is capped below 2^53.</para>
/// </remarks>
public static class CtrmSyntheticId
{
    /// <summary>Start of the reserved band. Chosen to sit far above any ODS surrogate value while
    /// leaving room for <see cref="Span"/> underneath 2^53.</summary>
    public const long ReservedBase = 7_000_000_000_000_000;

    /// <summary>Width of the band. <see cref="ReservedBase"/> + <see cref="Span"/> is
    /// 9,000,000,000,000,000 — just under 2^53 − 1 (9,007,199,254,740,991), so every id round-trips
    /// through a JavaScript number exactly.</summary>
    public const long Span = 2_000_000_000_000_000;

    /// <summary>ASCII unit separator. Cannot occur in a CTRM key, so joined parts stay unambiguous
    /// and ("AB", "C") does not hash the same as ("A", "BC").</summary>
    private const char KeySeparator = '\u001F';

    /// <summary>True when <paramref name="id"/> was manufactured here rather than read from ODS.
    /// Useful in diagnostics and when reasoning about a mixed result set.</summary>
    public static bool IsSynthetic(long id) => id >= ReservedBase && id < ReservedBase + Span;

    /// <summary>Maps the given key parts to a stable id inside the reserved band.</summary>
    public static long From(params string?[] keyParts)
    {
        var key = string.Join(KeySeparator, keyParts.Select(p => p?.Trim() ?? string.Empty));
        return ReservedBase + (long)(Fnv1A64(key) % (ulong)Span);
    }

    /// <summary>FNV-1a, 64-bit. Not cryptographic — chosen because it is short, dependency-free and
    /// deterministic across processes and runtime versions, which <see cref="string.GetHashCode()"/>
    /// is explicitly not: it is randomized per process, so ids built on it would change on every
    /// restart and break client-side dedup.</summary>
    private static ulong Fnv1A64(string value)
    {
        const ulong offsetBasis = 14695981039346656037;
        const ulong prime = 1099511628211;

        var hash = offsetBasis;
        foreach (var b in Encoding.UTF8.GetBytes(value))
        {
            hash ^= b;
            hash *= prime;
        }
        return hash;
    }
}
