namespace GrainOriginatorPortal.Api.Authorization;

/// <summary>
/// Access rule for the organic certification ingest endpoint.
///
/// The caller is the integration that resolves NOP id to certification data — a machine identity
/// authenticating by client credentials with its own managed identity, holding the pre-existing
/// <c>Origination.Application</c> app role. Admin is included so the feed can be exercised and
/// re-run by hand without provisioning a second identity.
///
/// Named as a constant rather than a string literal at each use site, following
/// <see cref="UsageDashboardAccess.PolicyName"/>. The BarChart ingest policy it is modelled on
/// repeats its name as a literal in two files; that is a wart worth not copying, because a typo
/// in one of them fails open to "any signed-in user" rather than failing loudly.
/// </summary>
public static class OrganicIngestAccess
{
    /// <summary>Authorization policy name for the certification ingest endpoint. Pinned by a
    /// convention test in ControllerAuthorizationTests.</summary>
    public const string PolicyName = "OrganicCertificationIngest";
}
