# Security Architecture Specification: Burdi Design Pattern

> **Repository copy.** Source document: `SEC-ARCH-BURDI-001` v1.0, 2026-03-25, IT Security / Architecture, classification Confidential. Copied verbatim into the Origination repo on 2026-09-23 so the mobile planning documents can link to it. If IT Security publishes a newer version, replace this file and update [MOBILE-ARCHITECTURE-PLAN.md](../MOBILE-ARCHITECTURE-PLAN.md) and [ADR-001](../../adr/ADR-001-mobile-surface-topology.md). The Scoular-specific mechanics that implement this spec are in [developer-docs/EXTERNAL-SPA-GUIDE.md](../../../developer-docs/EXTERNAL-SPA-GUIDE.md).

**Document:** SEC-ARCH-BURDI-001
**Version:** 1.0
**Date:** 2026-03-25
**Classification:** Confidential
**Author:** IT Security / Architecture
**Applies to:** All new applications with mixed trust zones (internet-facing + internal components)

---

## 1. Purpose

This specification defines the mandatory security architecture for new Scoular applications that serve both external (internet-facing) and internal users. It is derived from the Burdi Architecture Review and codifies the design pattern to prevent the class of vulnerabilities discovered in that assessment -- primarily direct database access from untrusted clients and mixed trust zones within a single application.

All new applications matching this profile **must** conform to this specification. Exceptions require written approval from IT Security (asksecurity@scoular.com) with a documented risk acceptance via ServiceNow.

---

## 2. Architecture Overview

### 2.1 Reference Diagram

```text
┌─────────────────────────────────────────────────────────────────────┐
│                           INTERNET                                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                     ┌─────────▼─────────┐
                     │   Azure WAF /     │  Layer 1: Edge Protection
                     │   Front Door      │  - DDoS protection
                     │                   │  - Geo-filtering
                     │                   │  - OWASP Core Rule Set
                     └─────────┬─────────┘
                               │ HTTPS only (TLS 1.2+)
                     ┌─────────▼─────────┐
                     │  EXTERNAL API     │  Layer 2: Public API Surface
                     │  SERVICE          │  - Minimal attack surface
                     │  (e.g., Mobile,   │  - JWT auth per client
                     │   Partner API)    │  - No raw SQL
                     │  - Scoped to      │  - Input validation
                     │    specific use   │  - Rate limiting
                     │    case only      │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │  AZURE API        │  Layer 3: API Gateway
                     │  MANAGEMENT       │  - Centralized policy enforcement
                     │  (APIM)           │  - OAuth 2.0 / JWT validation
                     │                   │  - Rate limiting & throttling
                     │  - Subscription   │  - Request/response transformation
                     │    key mgmt       │  - Backend routing
                     │  - Logging &      │  - IP filtering
                     │    analytics      │  - Correlation ID injection
                     └─────────┬─────────┘
                               │ Internal API calls only
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  INTERNAL NETWORK / VNET      │
│                    ┌─────────▼──────────┐                           │
                     │  INTERNAL WEB APP  │  Layer 4: Internal App
│                    │  (VPN/LAN only)    │  - Admin & operations UI  │
                     │  - Reporting       │  - Full feature set
│                    │  - Management      │  - Azure AD / Entra ID    │
                     │    functions       │    authentication
│                    └─────────┬──────────┘                           │
                               │
│                    ┌─────────▼──────────┐                           │
                     │  API / BLL LAYER   │  Layer 5: Business Logic
│                    │  (Business Logic)  │  - ALL database access    │
                     │  - Parameterized   │    routes through here
│                    │    queries / ORM   │  - Authorization checks   │
                     │  - Validation      │  - Audit logging
│                    └─────────┬──────────┘                           │
                               │ Private endpoint only
│                    ┌─────────▼──────────┐                           │
                     │  DATABASE          │  Layer 6: Data Store
│                    │  (Azure SQL / etc) │  - Never internet-        │
                     │  - Private endpoint│    accessible
│                    │  - TDE enabled     │  - Firewall: BLL only     │
                     │  - Audit logging   │
│                    └────────────────────┘                           │
 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

### 2.2 Core Invariants

These rules are **non-negotiable** for any application following this pattern:

| # | Invariant | Rationale |
|---|-----------|-----------|
| 1 | **No direct database access from external clients** | A compromised client must never reach the database |
| 2 | **All database access through the BLL layer only** | Single point of enforcement for authorization, validation, and auditing |
| 3 | **External and internal components are separate deployments** | Different trust zones require independent security policies |
| 4 | **All external traffic passes through Azure APIM** | Centralized policy enforcement, rate limiting, and observability |
| 5 | **No credentials stored on client devices or in app bundles** | Credential theft from devices must not compromise backend systems |
| 6 | **No shared service accounts between tiers** | Blast radius containment -- a compromised tier cannot escalate |

---

## 3. Layer Specifications

### 3.1 Layer 1: Edge Protection (Azure WAF / Front Door)

**Purpose:** Filter malicious traffic before it reaches application code.

| Requirement | Implementation | Policy Ref |
|------------|----------------|------------|
| DDoS protection | Azure DDoS Protection Standard | ISM-ZTDR |
| WAF rules | OWASP Core Rule Set 3.2+ | A.8.26 |
| TLS termination | TLS 1.2 minimum, TLS 1.3 preferred | A.8.24 |
| Geo-filtering | Block traffic from countries with no business need | ISM-ZTDR |
| Custom rules | Block known-bad patterns specific to the application | A.8.26 |

**Bicep requirements:**
```
minTlsVersion: '1.2'
httpsOnly: true
```

### 3.2 Layer 2: External API Service

**Purpose:** Minimal, hardened API surface exposed to the internet. Scoped to a single use case (e.g., driver inventory pickup, partner data exchange).

| Requirement | Implementation | Policy Ref |
|------------|----------------|------------|
| Authentication | Short-lived JWT tokens (15 min max), per-client identity | A.5.15, ISM-ZTIAM |
| Authorization | Scoped claims -- only the operations this client needs | A.5.15 |
| Input validation | Server-side validation on all inputs (type, length, format, range) | A.8.28, CWE-20 |
| No SQL | Zero database query construction in this layer | CWE-89 |
| Error handling | Generic error messages to clients; detailed logging server-side | A.8.15 |
| HTTPS only | Reject HTTP connections; HSTS header | A.8.24 |
| CORS | Restrictive; only explicitly allowed origins | A.8.28 |
| Anti-tampering | Certificate pinning for mobile clients where feasible | ISM-ZTDR |

**What this layer must NOT contain:**
- Admin or management endpoints
- Reporting or bulk data export
- Direct database connection strings or ORM context
- Secrets in configuration files or app bundles

### 3.3 Layer 3: Azure API Management (APIM)

**Purpose:** Centralized API gateway providing policy enforcement, traffic management, and observability between external services and internal backends.

| Requirement | Implementation | Policy Ref |
|------------|----------------|------------|
| JWT validation | Validate tokens at the gateway before forwarding | ISM-ZTIAM |
| Rate limiting | Per-subscription and per-IP throttling | A.8.26, ISM-ZTAPI |
| Subscription keys | Required for all API consumers; rotated quarterly | A.5.15 |
| IP filtering | Allowlist known IP ranges where applicable | ISM-ZTDR |
| Request transformation | Strip/redact sensitive headers before backend forwarding | A.8.15 |
| Response transformation | Remove internal error details, server headers | CWE-209 |
| Logging | Log all requests with correlation IDs to Azure Monitor / App Insights | A.8.15 |
| Backend routing | Route to internal services via private endpoints only | ISM-ZTDR |
| CORS policy | Enforce at the gateway level | A.8.28 |
| API versioning | Mandatory versioned endpoints (e.g., `/v1/resource`) | A.8.28 |

**APIM policies (mandatory):**
- `validate-jwt` -- on every inbound request
- `rate-limit-by-key` -- per subscription or caller IP
- `set-header` -- inject correlation ID, strip server headers
- `ip-filter` -- where client IP ranges are known
- `quota-by-key` -- daily/monthly call limits per consumer

### 3.4 Layer 4: Internal Web Application

**Purpose:** Full-featured application for internal users, accessible only via VPN or corporate LAN.

| Requirement | Implementation | Policy Ref |
|------------|----------------|------------|
| Authentication | Azure AD / Entra ID with MFA required | A.5.15, ISM-ZTIAM |
| Authorization | Role-based access control (RBAC) with `[Authorize]` on all controllers | A.5.15 |
| Session management | httpOnly, Secure, SameSite=Strict cookies; 30-min sliding expiration | A.8.28 |
| CSRF protection | `[ValidateAntiForgeryToken]` on all state-changing operations | CWE-352 |
| Network access | VPN/LAN only -- no public internet exposure | ISM-ZTDR |
| Security headers | X-Content-Type-Options, X-Frame-Options, CSP, HSTS | A.8.28 |
| Angular XSS | Property binding only; no `innerHTML` with user input; no `bypassSecurityTrust*` | CWE-79 |
| Secrets | User Secrets (dev), Azure Key Vault (prod) -- never in appsettings.json | A.8.28, CWE-798 |

### 3.5 Layer 5: API / Business Logic Layer (BLL)

**Purpose:** The **sole** path to the database. Enforces business rules, authorization, validation, and auditing.

| Requirement | Implementation | Policy Ref |
|------------|----------------|------------|
| Data access | Entity Framework with LINQ or parameterized queries only | CWE-89 |
| No dynamic SQL | Never concatenate user input into queries | CWE-89 |
| Authorization | Re-validate caller permissions before every data operation | A.5.15, ISM-ZTIAM |
| Input validation | Validate all inputs again at this layer (defense in depth) | CWE-20 |
| Audit logging | Log all data mutations with caller identity, timestamp, before/after values | A.8.15 |
| No PII in logs | Never log passwords, tokens, PII, or sensitive business data | A.8.15 |
| Error handling | Catch exceptions; return safe error codes; log full details internally | CWE-209 |
| Service accounts | Dedicated managed identity per consuming tier; no shared accounts | ISM-ZTIAM |

**Service account model:**

| Consumer | Service Account | Permissions |
|----------|----------------|-------------|
| External API Service | `mi-app-external-{env}` | Read/write on scoped tables/procedures only |
| Internal Web App | `mi-app-internal-{env}` | Broader role-scoped permissions |

### 3.6 Layer 6: Database

**Purpose:** Data persistence. Never directly accessible from external networks.

| Requirement | Implementation | Policy Ref |
|------------|----------------|------------|
| Network access | Private endpoint only; `publicNetworkAccess: 'Disabled'` | ISM-ZTDR |
| Firewall | Accept connections only from BLL layer subnet | ISM-ZTDR |
| Encryption at rest | Transparent Data Encryption (TDE) with AES-256 | A.8.24 |
| Encryption in transit | TLS 1.2+ enforced | A.8.24 |
| Authentication | Managed Identity (no SQL auth passwords) | ISM-ZTIAM |
| Auditing | Azure SQL Auditing enabled; logs to Log Analytics | A.8.15 |
| Backup | Geo-redundant backups with point-in-time restore | A.8.13 |
| Classification | Tag with data classification level per column/table | A.5.12 |

---

## 4. Authentication and Identity

### 4.1 Authentication Priority (per Scoular policy)

| Priority | Method | Use Case |
|----------|--------|----------|
| 1 | Managed Identity | Service-to-service (BLL to DB, App to Key Vault) |
| 2 | Azure AD / Entra ID | Internal user authentication (with MFA) |
| 3 | JWT with Azure AD B2C | External user/device authentication |
| 4 | Service Principal | CI/CD pipelines, automation |
| 5 | Database local account | **Avoid** -- last resort only |

### 4.2 Token Specifications

| Token Type | Lifetime | Refresh | Storage |
|------------|----------|---------|---------|
| External API JWT | 15 minutes max | Refresh token (24h), single-use, rotated | Secure device storage (Keychain/Keystore) |
| Internal session cookie | 30 minutes sliding | Server-side renewal | httpOnly, Secure, SameSite=Strict |
| APIM subscription key | 90 days | Rotated quarterly | Azure Key Vault |

### 4.3 Device Binding (Mobile Clients)

- JWT claims must include a device identifier
- Token reuse from a different device must be rejected
- Certificate pinning recommended for mobile apps
- Jailbreak/root detection recommended

---

## 5. Network Security

### 5.1 Network Zones

```text
Zone 1: Internet (untrusted)
  │
  ├── WAF / Front Door (edge filtering)
  │
Zone 2: DMZ (semi-trusted)
  │
  ├── External API Service
  ├── Azure APIM
  │
Zone 3: Internal Network / VNet (trusted)
  │
  ├── Internal Web App
  ├── BLL Layer
  │
Zone 4: Data (restricted)
  │
  └── Database (private endpoint only)
```

### 5.2 Allowed Traffic Flows

| Source | Destination | Protocol | Port | Auth |
|--------|------------|----------|------|------|
| Internet | WAF/Front Door | HTTPS | 443 | N/A (filtered) |
| WAF | External API Service | HTTPS | 443 | WAF-forwarded headers |
| External API Service | APIM | HTTPS | 443 | Subscription key + JWT |
| APIM | BLL Layer | HTTPS | 443 | Managed Identity |
| Internal Web App | BLL Layer | HTTPS | 443 | Managed Identity |
| BLL Layer | Database | TDS/TLS | 1433 | Managed Identity |
| VPN/LAN users | Internal Web App | HTTPS | 443 | Azure AD + MFA |

**All other traffic flows are denied by default (Zero Trust).**

### 5.3 Azure Networking Requirements (Bicep)

- VNet with dedicated subnets per tier
- Network Security Groups (NSGs) per subnet with explicit deny-all default
- Private endpoints for all data services (SQL, Storage, Key Vault)
- No public IP addresses on internal resources
- Azure Private DNS Zones for private endpoint resolution

---

## 6. Secrets Management

| Secret Type | Development | Production |
|-------------|------------|------------|
| Connection strings | User Secrets / local.settings.json (gitignored) | Azure Key Vault |
| API keys | User Secrets | Azure Key Vault |
| Certificates | Local cert store | Azure Key Vault |
| APIM subscription keys | User Secrets | Azure Key Vault, auto-rotated |

**Prohibited:**
- Secrets in source code, appsettings.json, environment.ts, or Bicep parameters
- Secrets in CI/CD pipeline definitions (use variable groups linked to Key Vault)
- Shared secrets between environments
- Long-lived secrets without rotation policy

---

## 7. Logging and Monitoring

### 7.1 What to Log

| Event | Required Fields |
|-------|----------------|
| Authentication success/failure | User ID, timestamp, IP, device ID, result |
| Authorization failure | User ID, resource, action, timestamp |
| Data mutation (create/update/delete) | User ID, entity, before/after values, timestamp |
| API call (APIM) | Correlation ID, caller IP, subscription, endpoint, status, latency |
| Rate limit triggered | Caller IP, subscription, endpoint, timestamp |
| Input validation failure | Endpoint, field, rejected value (redacted if sensitive) |

### 7.2 What to Never Log

- Passwords, tokens, API keys, or secrets
- Full credit card numbers, SSNs, or PII
- Database connection strings
- Key Vault secret values
- Request/response bodies containing sensitive data

### 7.3 Monitoring and Alerting

| Alert | Condition | Severity |
|-------|-----------|----------|
| Brute force detected | >10 auth failures from same IP in 5 minutes | Critical |
| Rate limit sustained | Rate limit triggered >100 times in 10 minutes | High |
| Database access anomaly | Query from unexpected source IP | Critical |
| Certificate expiry | Certificate expires within 30 days | High |
| External API error spike | >5% error rate sustained for 5 minutes | High |

---

## 8. Data Classification

All data handled by the application must be classified and protected accordingly:

| Classification | Examples | Encryption | Access Control | Logging |
|---------------|----------|------------|----------------|---------|
| **Highly Confidential** | PHI, PII, trade secrets, credentials | AES-256 at rest, TLS 1.2+ in transit | Named users only, audit trail required | Full audit logging |
| **Confidential** | Internal business data, contracts | AES-256 at rest, TLS 1.2+ in transit | Role-based, need-to-know | Standard logging |
| **Public** | Published content | TLS in transit | No restriction | Basic logging |

Database columns containing Highly Confidential data must use Always Encrypted or column-level encryption.

---

## 9. Deployment and Infrastructure

### 9.1 Bicep/IaC Requirements

All infrastructure must be deployed via Bicep templates with the following mandatory settings:

```bicep
// Mandatory for all data resources
resource sqlServer 'Microsoft.Sql/servers@2023-05-01-preview' = {
  properties: {
    publicNetworkAccess: 'Disabled'
    minimalTlsVersion: '1.2'
    administrators: {
      azureADOnlyAuthentication: true  // No SQL auth
    }
  }
}

// Mandatory tagging
tags: {
  Environment: environment
  DataClassification: dataClassification
  Owner: ownerEmail
  CostCenter: costCenter
  Application: applicationName
}
```

### 9.2 Environment Separation

| Environment | Data | Network | Secrets |
|------------|------|---------|---------|
| Development | Synthetic/anonymized only | Isolated VNet | Dev Key Vault |
| Staging | Synthetic/anonymized only | Isolated VNet | Staging Key Vault |
| Production | Real data | Production VNet | Production Key Vault |

**No production data in non-production environments. No exceptions.**

### 9.3 CI/CD Pipeline Requirements

- SAST scanning on every pull request
- Dependency vulnerability scanning (NuGet, npm)
- Bicep what-if validation before deployment
- Automated security tests in staging
- Peer code review required for all merges
- ServiceNow change request for production deployments

---

## 10. Compliance Mapping

| Spec Requirement | ISO 27001 | Zero Trust | CWE/SANS | OWASP |
|-----------------|-----------|------------|----------|-------|
| No direct DB from clients | A.8.26 | ISM-ZTDR | CWE-89 | A03:2021 |
| Separate trust zones | A.8.31 | ISM-ZTDR | -- | A04:2021 |
| JWT auth on external APIs | A.5.15 | ISM-ZTIAM | CWE-287 | A07:2021 |
| APIM gateway enforcement | A.8.26 | ISM-ZTAPI | CWE-862 | A01:2021 |
| Parameterized queries only | A.8.28 | ISM-ZTAP | CWE-89 | A03:2021 |
| Managed Identity for DB | A.5.15 | ISM-ZTIAM | CWE-798 | A07:2021 |
| Private endpoints | A.8.20 | ISM-ZTDR | -- | -- |
| Secrets in Key Vault | A.8.24 | ISM-ZTSS | CWE-798 | A02:2021 |
| Input validation at all layers | A.8.28 | ISM-ZTAP | CWE-20 | A03:2021 |
| Audit logging | A.8.15 | ISM-ZTDR | -- | A09:2021 |
| Rate limiting | A.8.26 | ISM-ZTAPI | CWE-770 | A04:2021 |
| TLS 1.2+ everywhere | A.8.24 | ISM-ZTDR | CWE-319 | A02:2021 |

---

## 11. Developer Checklist

Before submitting a new application for review, verify:

- [ ] External and internal components are separate deployable services
- [ ] External API has no direct database access
- [ ] All database access routes through BLL layer
- [ ] Azure APIM sits between external API and internal services
- [ ] Azure WAF / Front Door protects internet-facing endpoints
- [ ] JWT authentication on all external API endpoints
- [ ] Azure AD / Entra ID + MFA on internal application
- [ ] Managed Identity for all service-to-service auth
- [ ] All secrets in Azure Key Vault (none in code or config)
- [ ] Private endpoints for database and sensitive services
- [ ] `publicNetworkAccess: 'Disabled'` on data resources
- [ ] TLS 1.2+ enforced on all connections
- [ ] Input validation at every layer (client, API, BLL)
- [ ] Parameterized queries or ORM only (no string concatenation)
- [ ] Rate limiting configured in APIM
- [ ] Security headers configured (HSTS, CSP, X-Frame-Options, etc.)
- [ ] Audit logging for auth events and data mutations
- [ ] No PII or secrets in logs
- [ ] Separate service accounts per tier (no shared credentials)
- [ ] Infrastructure deployed via Bicep with mandatory tags
- [ ] SAST and dependency scanning in CI/CD pipeline
- [ ] Environment separation enforced (no prod data in dev/staging)

---

## 12. Review and Approval

| Stage | Reviewer | Artifact |
|-------|----------|----------|
| Architecture review | IT Security + Solutions Architect | This spec (completed and customized) |
| Code review | Peer developer + security reviewer | Pull request with security checklist |
| Pre-production security review | IT Security | Security Review Report (per template) |
| Change approval | Change Advisory Board | ServiceNow change request |

---

## 13. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-25 | IT Security / Architecture | Initial version based on Burdi Architecture Review |

---

**Questions or exceptions:** Contact IT Security at asksecurity@scoular.com
