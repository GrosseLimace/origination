using Azure.Core;
using Azure.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Design-time factory for EF Core migrations (used by dotnet ef commands only).
/// Excludes ManagedIdentityCredential so CI/CD self-hosted runners authenticate
/// via Azure CLI (the service principal from azure/login) instead of the
/// runner VMSS managed identity, which does not have database access.
/// This does NOT affect runtime behavior — the App Service uses Program.cs DI config.
/// </summary>
public class ApplicationDbContextFactory : IDesignTimeDbContextFactory<ApplicationDbContext>
{
    public ApplicationDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

        if (string.IsNullOrEmpty(connectionString))
            throw new InvalidOperationException(
                "Set the 'ConnectionStrings__DefaultConnection' environment variable before running dotnet ef commands.");

        // Strip Authentication= so we supply the token ourselves via AccessToken.
        var csb = new SqlConnectionStringBuilder(connectionString);
        csb.Authentication = SqlAuthenticationMethod.NotSpecified;

        var connection = new SqlConnection(csb.ConnectionString);

        // Exclude ManagedIdentityCredential — falls through to AzureCliCredential,
        // which uses the service principal authenticated by azure/login in CI/CD,
        // or az login credentials locally.
        var credential = new DefaultAzureCredential(new DefaultAzureCredentialOptions
        {
            ExcludeManagedIdentityCredential = true
        });

        var token = credential.GetToken(
            new TokenRequestContext(["https://database.windows.net/.default"]));
        connection.AccessToken = token.Token;

        var optionsBuilder = new DbContextOptionsBuilder<ApplicationDbContext>();
        optionsBuilder.UseSqlServer(connection, sqlOptions =>
        {
            sqlOptions.EnableRetryOnFailure(
                maxRetryCount: 5,
                maxRetryDelay: TimeSpan.FromSeconds(30),
                errorNumbersToAdd: null);
            sqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "dbo");
        });

        return new ApplicationDbContext(optionsBuilder.Options);
    }
}
