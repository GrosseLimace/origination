using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// The one place that decides whether a string is a Scoular Teams "send to channel" address.
/// <para>
/// Such an address has the shape <c>{id}.{tenant-domain}@{region}.teams.ms</c>, e.g.
/// <c>8e5da312.scoular.com@amer.teams.ms</c>. The <c>*.teams.ms</c> host is shared across EVERY
/// Microsoft 365 tenant, so the tenant is identified by the LOCAL part: requiring it to end in
/// <c>.scoular.com</c> is what keeps a channel post inside Scoular and blocks cross-tenant
/// exfiltration.
/// </para>
/// <para>
/// Shared by the recap-group save path and the channel registry so the rule cannot drift between
/// them — a second, laxer copy would be a way around the first.
/// </para>
/// </summary>
public static class TeamsChannelAddress
{
    private const string ChannelHostSuffix = ".teams.ms";
    private const string ScoularTenantSuffix = ".scoular.com";

    public static bool IsScoularChannel(string? address)
    {
        var channel = address?.Trim();
        if (string.IsNullOrWhiteSpace(channel)) return false;

        var atIndex = channel.LastIndexOf('@');
        var localPart = atIndex > 0 ? channel[..atIndex] : string.Empty;
        var host = atIndex >= 0 ? channel[(atIndex + 1)..] : string.Empty;

        return new EmailAddressAttribute().IsValid(channel)
            && host.EndsWith(ChannelHostSuffix, StringComparison.OrdinalIgnoreCase)
            && localPart.EndsWith(ScoularTenantSuffix, StringComparison.OrdinalIgnoreCase);
    }
}
