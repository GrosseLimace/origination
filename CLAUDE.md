# Origination (Grain Originator Portal)

Angular 21 client + .NET 10 API. Start with [README.md](README.md); feature and architecture
notes live in [docs/application-context/](docs/application-context/), operations in
[docs/operations/](docs/operations/), and the audit tracker in
[agents-docs/audits/AUDIT-TRACKING.json](agents-docs/audits/AUDIT-TRACKING.json).

## Software Bill of Materials (SBOM)
Last Updated: 2026-10-20

Direct dependencies plus the transitive packages pinned for security. This is the compact copy
company policy asks for here; [README.md](README.md#software-bill-of-materials-sbom) has the same
rows with the security notes behind each pin. Update BOTH in the same commit as any dependency change.

### Backend Dependencies (C# / .NET 10)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| Azure.Extensions.AspNetCore.Configuration.Secrets | 1.5.0 | MIT | Azure Key Vault config provider |
| Azure.Identity | 1.18.0 | MIT | Managed Identity / Key Vault authentication |
| Microsoft.AspNetCore.OpenApi | 10.0.1 | MIT | Swagger / OpenAPI support |
| Microsoft.Data.SqlClient | 6.1.4 | MIT | SQL Server driver |
| Microsoft.EntityFrameworkCore.SqlServer | 10.0.1 | MIT | EF Core ORM for SQL Server |
| Microsoft.EntityFrameworkCore.Design | 10.0.1 | MIT | EF Core design-time tools |
| Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore | 10.0.3 | MIT | EF Core health check endpoint |
| Microsoft.Extensions.Http.Resilience | 10.3.0 | MIT | HTTP retry / resilience policies |
| Microsoft.Identity.Web | 3.8.4 | MIT | Azure AD / JWT Bearer authentication |
| System.Security.Cryptography.Xml | 10.0.13 | MIT | XML crypto |
| System.Security.Cryptography.Pkcs | 10.0.13 | MIT | PKCS / CMS crypto (pinned) |

### Frontend Dependencies (Angular 21 / TypeScript)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| @angular/core | 21.2.25 | MIT | UI framework |
| @angular/common | 21.2.25 | MIT | Common directives, pipes and HttpClient |
| @angular/router | 21.2.25 | MIT | Client-side routing |
| @angular/forms | 21.2.25 | MIT | Reactive forms |
| @angular/animations | 21.2.25 | MIT | Animation support |
| @azure/msal-angular | 5.1.1 | MIT | Azure AD authentication |
| @azure/msal-browser | 5.4.0 | MIT | MSAL browser runtime |
| @microsoft/applicationinsights-web | 3.4.5 | MIT | Browser error telemetry to Application Insights |
| @it/design-system | 0.1.1 | Internal | Scoular IT design system components |
| leaflet | 1.9.4 | BSD-2-Clause | Interactive map rendering |
| leaflet.markercluster | ~1.5.3 | MIT | Leaflet marker clustering |
| rxjs | 7.8.2 | Apache-2.0 | Reactive programming |
| jspdf | 4.2.1 | MIT | Client-side PDF generation |
| jspdf-autotable | 5.0.8 | MIT | Tabular layout for jsPDF |
| tslib | 2.8.1 | 0BSD | TypeScript runtime helpers |
| zone.js | 0.15.1 | MIT | Angular change detection zone |
| tailwindcss | 4.2.1 | MIT | Utility-first CSS framework |
| vitest | 4.1.11 | MIT | Unit testing framework |
| typescript | 5.9.3 | Apache-2.0 | TypeScript compiler |
| esbuild | ≥0.28.1 | MIT | Bundler |
| vite | ≥7.3.5 | MIT | Dev server/bundler |
| @babel/core | ≥7.29.6 | MIT | JS compiler |
| browserslist | ≥4.28.7 | MIT | Browser-target resolution |
| tar | ≥7.5.21 | ISC | Tar parser |
| pacote | ≥21.5.1 | ISC | npm package fetcher |
| ws | ≥8.21.0 | MIT | WebSocket |
| brace-expansion | ≥5.0.12 | MIT | Brace pattern expansion |
| postcss | 8.5.23 | MIT | CSS processor |
| body-parser | ≥2.3.0 | MIT | HTTP body parsing |
| qs | ≥6.16.0 <7 | BSD-3-Clause | Query-string parser |
| immutable | ≥5.1.8 | MIT | Immutable collections |
| fast-uri | ≥3.1.8 <4 | BSD-3-Clause | URI parser |
| hono | ≥4.13.5 <5 | MIT | Web framework |
| undici | ≥7.29.1 <8 | MIT | HTTP/1.1 client |
| proxy-addr | ≥2.0.8 <3 | MIT | Trusted-proxy / X-Forwarded-For resolution |
| source-map-js | ≥1.2.2 <2 | BSD-3-Clause | Source map parsing/generation |
| @modelcontextprotocol/sdk | ≥1.31.0 <2 | MIT | Model Context Protocol SDK |
| ip-address | ≥10.5.1 | MIT | IP address parser |
| @hono/node-server | ≥2.0.5 | MIT | Node adapter for hono |
| dompurify | ≥3.4.16 <4 | (MIT OR Apache-2.0) | HTML sanitizer |
| piscina | ≥5.3.2 <6 | MIT | Worker-thread pool |
