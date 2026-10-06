namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// The ONE definition of "production-like" for the diagnostics controllers. Local Development and the deployed
/// Dev and QA App Services (ASPNETCORE_ENVIRONMENT "Dev" / "QA") are open; every other environment name — PROD,
/// staging, a blank or a misspelled one — is production-like, so a gated route answers 404 there.
/// </summary>
/// <remarks>
/// <c>DiagnosticsController.DenyIfProduction()</c> and <c>CustomerSyncDiagnosticsController</c> both delegate
/// here so the two cannot drift. <c>DiagnosticsController.DenyIfNotDevelopment()</c> is a different, stricter gate
/// (Development and QA only) and does not use this.
/// </remarks>
public static class DiagnosticsEnvironmentGate
{
    public static bool IsProductionLike(IWebHostEnvironment env) =>
        !(env.IsDevelopment() || env.IsEnvironment("Dev") || env.IsEnvironment("QA"));
}
