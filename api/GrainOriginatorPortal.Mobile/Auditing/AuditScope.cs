using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GrainOriginatorPortal.Mobile.Auditing;

/// <summary>
/// Default <see cref="IAuditScope"/>: serialises state to JSON and redacts PII-bearing properties
/// before it can reach a log sink (SEC-ARCH-BURDI-001 §7.2 "never log PII"). Redacted values are
/// replaced by a short SHA-256 fingerprint so an auditor can still see that a value changed.
/// </summary>
public sealed class AuditScope : IAuditScope
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
    };

    // Matched case-insensitively against property names. Kept deliberately broad.
    private static readonly string[] RedactedNameFragments = ["phone", "email", "contact"];

    public string? EntityType { get; private set; }
    public object? EntityId { get; private set; }
    public string? BeforeJson { get; private set; }
    public string? AfterJson { get; private set; }

    public void Entity(string entityType, object? entityId)
    {
        EntityType = entityType;
        EntityId = entityId;
    }

    public void Before<T>(T? state) where T : class => BeforeJson = Redact(state);

    public void After<T>(T? state) where T : class => AfterJson = Redact(state);

    internal static string? Redact<T>(T? state) where T : class
    {
        if (state is null) return null;

        var node = JsonSerializer.SerializeToNode(state, SerializerOptions);
        if (node is null) return null;

        RedactNode(node, redactValues: false);
        return node.ToJsonString(SerializerOptions);
    }

    /// <summary>
    /// Walks the JSON. Once inside a PII-named property (e.g. <c>contacts</c>), EVERY scalar beneath it is
    /// fingerprinted — a contact's <c>name</c> is personal data too (STD-MAA-001 MAA-6.1), not just its phone
    /// and email. True/false flags (e.g. <c>isPrimary</c>) carry no personal data and stay readable.
    /// </summary>
    private static void RedactNode(JsonNode node, bool redactValues)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var key in obj.Select(kvp => kvp.Key).ToList())
                {
                    var child = obj[key];
                    if (child is null) continue;

                    var redact = redactValues || IsRedacted(key);
                    if (child is JsonValue value)
                    {
                        if (redact && !IsBoolean(value)) obj[key] = Fingerprint(value.ToJsonString());
                    }
                    else
                    {
                        RedactNode(child, redact);
                    }
                }
                break;

            case JsonArray array:
                for (var i = 0; i < array.Count; i++)
                {
                    var child = array[i];
                    if (child is null) continue;

                    if (child is JsonValue value)
                    {
                        if (redactValues && !IsBoolean(value)) array[i] = Fingerprint(value.ToJsonString());
                    }
                    else
                    {
                        RedactNode(child, redactValues);
                    }
                }
                break;
        }
    }

    private static bool IsBoolean(JsonValue value)
        => value.GetValueKind() is JsonValueKind.True or JsonValueKind.False;

    private static bool IsRedacted(string propertyName)
        => RedactedNameFragments.Any(f => propertyName.Contains(f, StringComparison.OrdinalIgnoreCase));

    private static string Fingerprint(string rawJsonValue)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(rawJsonValue));
        return "sha256:" + Convert.ToHexString(hash.AsSpan(0, 6)).ToLowerInvariant();
    }
}
