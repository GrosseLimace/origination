namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// The id band the customer sync mints from when the CTRM source discovers a producer the app has never held.
/// </summary>
/// <remarks>
/// <para><b>Why a band.</b> <c>dbo.Customer.Id</c> was historically the ODS surrogate id. A producer that exists
/// only in CTRM has no such id, so the sync mints one from <c>dbo.CustomerIdSequence</c> inside a reserved range.
/// A range makes a minted id recognisable on sight (<see cref="IsMinted"/>) and guarantees it can never collide
/// with an ODS-assigned id, whatever the ODS does next.</para>
///
/// <para><b>Why it sits below 7e15.</b> The band ends at <c>6e15</c>, underneath
/// <see cref="Ctrm.CtrmSyntheticId.ReservedBase"/> (<c>7e15</c>), so a minted customer id can never be mistaken for
/// a synthetic contract or ticket id. Every id also stays under 2^53 − 1 (9,007,199,254,740,991), so it
/// round-trips through a JavaScript number exactly — customer ids reach the browser as TypeScript numbers.</para>
///
/// <para><b>Why the migration still reads the live max.</b> The sequence is created starting above the larger of
/// <see cref="ReservedBase"/> and the live <c>MAX(Id)</c> in <c>dbo.Customer</c>, so a table that somehow already
/// holds a larger id never yields a duplicate.</para>
///
/// <para><b>Permanent convention.</b> Once a minted id carries notes, planting intentions or saved lists in PROD,
/// the band cannot move: these ids are referenced by string-matched and stored data. Treat the constants as frozen.</para>
/// </remarks>
public static class CustomerIdMinting
{
    /// <summary>First id of the minted band.</summary>
    public const long ReservedBase = 5_000_000_000_000_000;

    /// <summary>Width of the band; <see cref="ReservedBase"/> + <see cref="Span"/> is 6e15.</summary>
    public const long Span = 1_000_000_000_000_000;

    /// <summary>Schema of the sequence minted ids are drawn from.</summary>
    public const string SequenceSchema = "dbo";

    /// <summary>Name of the sequence minted ids are drawn from.</summary>
    public const string SequenceName = "CustomerIdSequence";

    /// <summary>True when <paramref name="id"/> lies inside the minted band.</summary>
    public static bool IsMinted(long id) => id >= ReservedBase && id < ReservedBase + Span;
}
