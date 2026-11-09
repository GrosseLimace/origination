using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;


namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;

/// <summary>
/// Stands in for CTRM's Customer Splits Inquiry until the CTRM GraphQL query for splits is identified
/// (Lisa/Travis). Returns the same made-up list for every producer, with IDs built from the producer's code
/// (TATOBIN → TATOB01, TATOB02…). Selected by <c>Ctrm:SplitsSource</c> = <c>sample</c>, the default.
/// </summary>
public sealed class SampleCtrmSplitReader : ICtrmSplitReader
{
    private static readonly (string Field, decimal Percent, DateOnly Effective, CtrmSplitKind Kind, bool Expired)[] Sample =
    [
        ("NORTH 80", 100m, new DateOnly(2018, 10, 1), CtrmSplitKind.Field, false),
        ("HOME PLACE IRR", 100m, new DateOnly(2018, 10, 15), CtrmSplitKind.Field, false),
        ("SOUTH PIVOT IRR", 50m, new DateOnly(2024, 9, 1), CtrmSplitKind.Field, false),
        ("RIVER BOTTOM DRY", 66.667m, new DateOnly(2018, 12, 1), CtrmSplitKind.Field, false),
        ("WEST QUARTER DRY", 100m, new DateOnly(2019, 9, 1), CtrmSplitKind.Field, false),
        ("ANDERSON", 66.667m, new DateOnly(2020, 11, 1), CtrmSplitKind.Field, false),
        ("BIN", 100m, new DateOnly(2024, 9, 1), CtrmSplitKind.Bin, false),
        ("OLD HOME 40", 100m, new DateOnly(2016, 10, 1), CtrmSplitKind.Field, true),
    ];

    public string Source => "sample";

    public Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>> GetForProducerAsync(string producerCode, CancellationToken cancellationToken)
    {
        var primary = producerCode.Trim().ToUpperInvariant();
        var prefix = primary.Length > 5 ? primary[..5] : primary;
        IReadOnlyList<CtrmSplit> splits = Sample
            .Select((s, i) => new CtrmSplit($"{prefix}{i + 1:00}", primary, $"{primary} - {s.Field}", s.Field, s.Percent, s.Effective, s.Expired, s.Kind))
            .ToList();
        return Task.FromResult(new CtrmReadResult<IReadOnlyList<CtrmSplit>> { Status = CtrmReadStatus.Ok, Value = splits });
    }
}
