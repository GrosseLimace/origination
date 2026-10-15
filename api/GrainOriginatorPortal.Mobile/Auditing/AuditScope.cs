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

        RedactNode(node, parentName: null);
        return node.ToJsonString(SerializerOptions);
    }

    private static void RedactNode(JsonNode node, string? parentName)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var key in obj.Select(kvp => kvp.Key).ToList())
                {
                    var child = obj[key];
                    if (child is null) continue;

                    if (IsRedacted(key) && child is JsonValue)
                    {
                        obj[key] = Fingerprint(child.ToJsonString());
                    }
                    else
                    {
                        RedactNode(child, key);
                    }
                }
                break;

            case JsonArray array:
                for (var i = 0; i < array.Count; i++)
                {
                    var child = array[i];
                    if (child is null) continue;

                    if (parentName is not null && IsRedacted(parentName) && child is JsonValue)
                    {
                        array[i] = Fingerprint(child.ToJsonString());
                    }
                    else
                    {
                        RedactNode(child, parentName);
                    }
                }
                break;
        }
    }

    private static bool IsRedacted(string propertyName)
        => RedactedNameFragments.Any(f => propertyName.Contains(f, StringComparison.OrdinalIgnoreCase));

    private static string Fingerprint(string rawJsonValue)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(rawJsonValue));
        return "sha256:" + Convert.ToHexString(hash.AsSpan(0, 6)).ToLowerInvariant();
    }
}
