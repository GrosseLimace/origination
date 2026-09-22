// System namespaces
using System.Collections;
using System.Reflection;
using System.Runtime.CompilerServices;

// Microsoft namespaces
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Builds <see cref="SqlException"/> instances without a live SQL connection. SqlException has no
/// public constructor, so both helpers allocate uninitialized objects; <see cref="WithNumber"/>
/// additionally wires an error collection so <c>ex.Number</c> reports a specific SQL error number —
/// the Ticket/Contract services branch on 207/208 (missing column / object) vs. everything else.
/// Field lookups go by type/shape rather than exact name so a SqlClient upgrade fails loudly here
/// instead of silently satisfying the wrong catch filter.
/// </summary>
public static class SqlExceptionDoubles
{
    private const BindingFlags InstanceFields = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;

    /// <summary>A SqlException whose <c>Number</c> reads 0 — the shape of a connection failure,
    /// timeout, or throttle as far as the services' catch filters are concerned.</summary>
    public static SqlException Transient() =>
        (SqlException)RuntimeHelpers.GetUninitializedObject(typeof(SqlException));

    /// <summary>A SqlException whose <c>Number</c> reads <paramref name="number"/> (e.g. 207 =
    /// invalid column name, 208 = invalid object name).</summary>
    public static SqlException WithNumber(int number)
    {
        var error = (SqlError)RuntimeHelpers.GetUninitializedObject(typeof(SqlError));
        Field(typeof(SqlError), f => f.FieldType == typeof(int)
                && f.Name.TrimStart('_').Equals("number", StringComparison.OrdinalIgnoreCase))
            .SetValue(error, number);

        var collection = (SqlErrorCollection)RuntimeHelpers.GetUninitializedObject(typeof(SqlErrorCollection));
        var listField = Field(typeof(SqlErrorCollection), f => typeof(IList).IsAssignableFrom(f.FieldType));
        var list = (IList)Activator.CreateInstance(listField.FieldType)!;
        list.Add(error);
        listField.SetValue(collection, list);

        var ex = Transient();
        Field(typeof(SqlException), f => f.FieldType == typeof(SqlErrorCollection)).SetValue(ex, collection);

        if (ex.Number != number)
            throw new InvalidOperationException(
                $"SqlException internals changed: asked for Number {number} but the instance reports {ex.Number}.");
        return ex;
    }

    private static FieldInfo Field(Type type, Func<FieldInfo, bool> match) =>
        type.GetFields(InstanceFields).FirstOrDefault(match)
        ?? throw new InvalidOperationException(
            $"No matching field on {type.Name}. Fields present: " +
            string.Join(", ", type.GetFields(InstanceFields).Select(f => $"{f.FieldType.Name} {f.Name}")));
}
