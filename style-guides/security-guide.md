# Security Guide — AI-Assisted Delivery (Azure • .NET • Angular)

**Version:** 0.2
**Date:** 2026-01-13
**Applies to:** Azure App Service (Web Apps), Azure SQL Database, .NET (C#) backend, Angular frontend, Azure DevOps repos/pipelines
**Purpose:** Establish a minimum security baseline and repeatable controls for teams using AI-assisted coding tools/agents.

> **Note:** This guide covers security for traditional web applications built using AI-assisted coding tools. For applications that integrate LLMs or AI agents as part of their functionality, see the companion [AI Application Security Guide](ai_application_security_guide.md).

---

## 1. Scope and goals

### 1.1 In scope

- Application security: API/backend, frontend, authn/authz, data handling, error handling, logging, and dependencies.
- DevSecOps controls: source control, pipelines, scanning, secrets handling, and release gates.
- Cloud workload controls relevant to your stack (App Service + Azure SQL).
- **AI-assisted development controls:** treating AI-generated code as untrusted, automated validation, and review processes for code the author cannot fully explain.

### 1.2 Out of scope

- Deep compliance mapping (e.g., SOC2/ISO) — add later if required.
- Pen-test planning and incident response runbooks (recommended, but separate docs).
- LLM/AI agent application security (see companion guide).

### 1.3 Security objectives

- Protect confidentiality, integrity, availability (CIA).
- Default-deny access, least privilege, secure-by-default configurations.
- Detect and respond: actionable security logging and alerting.
- **Validate AI-generated code automatically** — assume the author may not fully understand what the code does.

---

## 2. Minimum baseline (non-negotiables)

1. **No secrets in code** (including sample keys).
   - Use Azure Key Vault + Managed Identity (preferred) for secret retrieval and credentialless access patterns.

```rule
id: no-hardcoded-password-literals
source: security-guide.md§2
severity: error
description: No hardcoded password literals in source
applies-to: [changed-files]
files: ['*.cs', '*.ps1', '*.psm1', '*.bicep', '*.bicepparam', '*.json', '*.yaml', '*.yml', '*.xml', '*.xslt', '*.config', '*.sql', '*.tf', '*.py', '*.js', '*.ts', '*.env', '*.txt']
tool: grep-forbidden
args:
  pattern: 'password[[:space:]]*[:=][[:space:]]*"[^"$<{]{4,}"'
  ignore-case: true
  except: '(\$\(|\$\{|@Microsoft\.KeyVault|<<|placeholder|YOUR_|EXAMPLE|REDACTED|x{4,}|\*{4,}|\bnull\b|""|"""|TODO|TBD|sample|dummy|fake)'
message: Use Azure Key Vault + Managed Identity (security-guide.md §2). No hardcoded password literals.
```

```rule
id: no-hardcoded-api-keys
source: security-guide.md§2
severity: error
description: No hardcoded API keys / secret keys / access tokens / client secrets in source
applies-to: [changed-files]
files: ['*.cs', '*.ps1', '*.psm1', '*.bicep', '*.bicepparam', '*.json', '*.yaml', '*.yml', '*.xml', '*.xslt', '*.config', '*.sql', '*.tf', '*.py', '*.js', '*.ts', '*.env', '*.txt']
tool: grep-forbidden
args:
  pattern: '(api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|bearer[_-]?token)[[:space:]]*[:=][[:space:]]*"[A-Za-z0-9+/_=.\-]{16,}"'
  ignore-case: true
  except: '(\$\(|\$\{|@Microsoft\.KeyVault|<<|placeholder|YOUR_|EXAMPLE|REDACTED|x{4,}|\*{4,}|TODO|TBD|sample|dummy|fake)'
message: Move the value to Key Vault and reference via @Microsoft.KeyVault(...) (security-guide.md §2 / §5).
```

```rule
id: no-aws-access-key
source: security-guide.md§2
severity: error
description: AWS access keys in source (AKIA + 16 chars)
applies-to: [changed-files]
files: ['*']
tool: grep-forbidden
args:
  pattern: 'AKIA[0-9A-Z]{16}'
message: Move credentials to a secure store; rotate any committed keys immediately.
```

```rule
id: no-private-key-material
source: security-guide.md§2
severity: error
description: Private key PEM blocks in source
applies-to: [changed-files]
files: ['*']
tool: grep-forbidden
args:
  pattern: 'BEGIN[[:space:]]+(RSA[[:space:]]+|DSA[[:space:]]+|EC[[:space:]]+|OPENSSH[[:space:]]+)?PRIVATE[[:space:]]+KEY'
message: Private key material must never be committed; rotate immediately if it has been.
```

2. **Dependency hygiene is required**
   - Automated dependency scanning and upgrade workflow for .NET (NuGet) and Angular (npm).

3. **Authentication and authorization are explicit and testable**
   - Route-level + resource-level authorization; no "implicit trust" between tiers.

4. **Input is untrusted**
   - Validate at boundaries; encode on output; parameterize queries.

5. **Secure error handling**
   - No stack traces or sensitive content to clients; use correlation IDs.

6. **Security logging and alerting**
   - Log auth events, access denials, validation failures, and suspicious patterns.

7. **AI-generated code is untrusted code**
   - All AI-generated code must pass automated security validation before merge.
   - When the author cannot fully explain the code, additional review artifacts are required (see Section 9).

---

## 3. Threat modeling and secure design

### 3.1 When to do it

- At project kickoff, and whenever:
  - new data types (PII, financial data) are introduced,
  - new integration points are added,
  - authorization model changes.

### 3.2 What to produce (lightweight)

- **Data flow diagram (DFD):** browser → Angular → API → SQL/other dependencies.
- **Trust boundaries:** internet, app tier, data tier, third-party APIs.
- **Top risks list:** map to OWASP Top 10 (latest) categories.
- **Security requirements:** "musts" derived from the risks.

### 3.3 Reference baselines

- OWASP Top 10 (awareness) and OWASP ASVS (verifiable requirements).

---

## 4. Secure coding standards

### 4.1 Backend (.NET / ASP.NET Core)

**Authentication/Authorization**

- Prefer centralized auth (e.g., Entra ID) and standards (OIDC/OAuth2).
- Enforce authorization at the controller/endpoint and at domain/service layer for sensitive operations.

**CSRF**

- For cookie-auth, enforce anti-forgery protections broadly (non-API scenarios).
  - Use `AutoValidateAntiforgeryToken` to reduce "forgot to apply the attribute" risk.

**Input validation & injection**

- Validate all external inputs (body, headers, query params, files).
- Use parameterized queries/ORM; avoid string concatenation for SQL.
- For file uploads: validate MIME + extension + size; virus scan if required.

**Serialization**

- Use safe defaults; avoid insecure polymorphic deserialization patterns.
- Reject unexpected fields where possible.

**Data protection**

- Use ASP.NET Core Data Protection appropriately for tokens/cookies as needed.
- Plan key persistence/rotation; when storing keys, prefer Azure-native options (Key Vault/Blob) per documented guidance.

**Logging & privacy**

- Never log secrets/tokens/passwords.
- Use structured logs; include correlation ID; log auth failures and access denials.

**Exception handling**

- Return safe error envelopes; log detailed exceptions server-side.

### 4.2 Frontend (Angular)

- Rely on Angular's built-in protections; do not bypass sanitization unless absolutely necessary.
- Avoid using "trust" bypass APIs (e.g., `bypassSecurityTrust...`) without a security review.
- Treat all interpolated content as untrusted; encode/escape via framework mechanisms.
- Protect against CSRF/XSRF with server-side controls; use Angular's helpers where applicable.
- Token storage:
  - Prefer HttpOnly secure cookies for browser apps where feasible.
  - If using tokens in memory/local storage, document the threat model and mitigations.

```rule
id: angular-no-bypass-security-trust
source: security-guide.md§4.2
severity: error
description: Angular code must not call DomSanitizer.bypassSecurityTrust* — these calls disable XSS protection
applies-to: [changed-files]
files: ['*.ts', '*.html']
tool: grep-forbidden
args:
  pattern: 'bypassSecurityTrust[A-Z]\w*[[:space:]]*\('
message: |
  Do not call `bypassSecurityTrust*` (Html / Script / Url / ResourceUrl / Style). These
  APIs disable Angular's XSS sanitization for the value passed through them. If you need
  to render trusted SVG icons or markup, use an inline-template component (e.g. the
  `IconComponent` pattern in @it/angular-components v0.2+) — do not wrap raw strings.
  If you genuinely need untrusted HTML rendering, use a DOMPurify-backed pipe with an
  explicit allow-list. See style-guides/security-guide.md §4.2 and IT/gc-track-report
  ADR-005.
```

### 4.3 API-to-DB (Azure SQL)

- Principle of least privilege for DB users/roles.
- Parameterized queries only; no dynamic SQL unless strongly justified and reviewed.
- Encrypt in transit; enable TLS; validate certificates where applicable.
- Data classification: identify sensitive columns; consider encryption-at-rest defaults and additional measures for highly sensitive fields.

---

## 5. Secrets, identity, and key management (Azure)

### 5.1 Preferred pattern: Managed Identity + Key Vault

- Use Managed Identity for App Service to access Key Vault secrets/certs as needed.
- Prefer user-assigned managed identities when you want shared identity/permissions across resources or more controlled lifecycle.

### 5.2 Rules

- No secrets in appsettings checked into repo.
- Rotate secrets on a schedule; document rotation owners and process.
- Restrict Key Vault permissions narrowly (specific secrets, least privilege).

---

## 6. Software supply chain controls (DevSecOps)

### 6.1 Repository controls

- Protected branches, PR reviews, required checks.
- Block merges if critical security checks fail.

### 6.2 Required automated checks

- **Secret scanning** with push protection where available.
- **Dependency scanning** for NuGet and npm.
- **SAST (code scanning)** for common vulnerability patterns.

> If using Azure DevOps, GitHub Advanced Security for Azure DevOps can provide dependency scanning, secret scanning, and CodeQL-based code scanning.

### 6.3 Build provenance (recommended)

- Generate an SBOM for releases.
- Sign artifacts where your org standards require it.

### 6.4 SBOM and license compliance

- Generate SBOMs and block disallowed licenses in PRs.
- Use policy-based tools (e.g., Snyk, Mend) to tune severity and license rules.

---

## 7. CI/CD enforcement pattern

### 7.1 Pipeline stages

1. **Pre-commit (optional):** IDE extension for secrets scanning for advanced users.

2. **Pull Request gates (mandatory):**
   - Run SAST (CodeQL), SCA (Dependabot/Snyk/Mend), IaC checks.
   - Fail PR on high/critical findings.
   - Dependency Review: prevent introducing vulnerable packages.

3. **Build:**
   - Generate SBOM, sign artifacts.
   - Attach scan reports; map findings to ASVS controls.

4. **Deploy to test/staging:**
   - Validate security controls in realistic environment.

5. **Pre-prod:**
   - Security testing and validation.
   - Verify all scan gates passed.

6. **Prod:**
   - Continuous monitoring (Defender for Cloud, Sentinel).
   - Incident runbooks ready.

### 7.2 ASVS-aligned verification

Map findings to OWASP ASVS requirements (levels L1–L3) so reviews are consistent even for developers less experienced in security.

---

## 8. Security logging, monitoring, and alerting

### 8.1 Minimum application events to log

- Auth success/failure; MFA/conditional access outcomes where available.
- Authorization denials (403) and policy decisions.
- Input validation failures (rate-limit and summarize to avoid log spam).
- Administrative actions (create/update/delete critical resources).

### 8.2 Minimum cloud telemetry

- App Service logs + metrics (availability, latency, error rates).
- Database telemetry for unusual access patterns.

---

## 9. AI-generated code review process

When the author cannot fully explain AI-generated code, additional safeguards apply.

### 9.1 Required review artifacts

- **Auto-generated explainability report:** dependency graph, SBOM, permission diff, API allow-list.
- **Scan results summary:** all SAST/SCA/secrets findings with disposition.
- **Least privilege verification:** confirm service principals and permissions are minimally scoped.

### 9.2 Policy-as-code

Use policy-as-code tools (Snyk, Mend, or similar) to gate on:

- Severity thresholds (block high/critical)
- Reachability analysis (prioritize exploitable paths)
- License compliance rules

This allows reviewers to approve code without needing deep security expertise—the tooling enforces the policy.

### 9.3 Escalation triggers

Escalate to security review when AI-generated code includes:

- New authentication or authorization flows
- New cryptographic operations
- New external integrations or API consumers
- Handling of sensitive data types (PII, PHI, financial)

---

## 10. Tiered application trust model

Not every application requires the same level of rigor. Apply controls proportionally.

| Tier | Typical use | Required controls |
|------|-------------|-------------------|
| **Sandbox** | Experiments, prototypes | SCA scanning; no prod data; isolated environment |
| **Internal** | Department tools, internal utilities | Full CI gates (SAST/SCA/Secrets); SBOM; ASVS L1/L2; least privilege service principals; audit logs |
| **Business-critical** | Customer-facing, PII, financial | ASVS L2/L3; formal threat modeling; change control; continuous monitoring; periodic pen test |

### 10.1 Tier assignment

- Assign tier during project intake based on data sensitivity and exposure.
- Document tier in project metadata; reassess if scope changes.

---

## 11. Release gates and acceptance criteria

A release is **blocked** unless:

- No unresolved **critical/high** findings in dependency scan, secret scan, or SAST.
- Authz checks are covered by tests for privileged operations.
- Security logging requirements are met.
- SBOM generated and attached.
- Tier-appropriate ASVS controls verified.

---

## 12. Quick checklists

### 12.1 PR security checklist (developer)

- [ ] No secrets added (keys, connection strings, tokens).
- [ ] Input validation for new endpoints.
- [ ] Authorization enforced (not just in UI).
- [ ] Errors do not leak sensitive details.
- [ ] Dependency changes reviewed; no known critical vulns introduced.
- [ ] Tests added/updated for authz and edge cases.
- [ ] AI-generated code: can I explain what this does? If not, escalate or add review artifacts.

### 12.2 "High-risk change" triggers

Escalate to deeper review when you add:

- new auth flows, new roles/permissions, new file upload paths,
- new crypto usage, new external integrations, new data types (PII/PHI).

### 12.3 Deployment permit checklist

For any application to deploy:

1. [ ] Inventory entry created (owner, data types, tier, environment).
2. [ ] CI scans clean (no high/critical SAST/SCA/secrets; SBOM attached).
3. [ ] ASVS level met (L1 for sandbox; L2 for internal; L3 for sensitive).
4. [ ] Monitoring and audit configured.

---

## 13. Developer enablement

### 13.1 Safe patterns and templates

- Provide pre-secured templates: approved components, sample pipelines with scans/gates pre-configured.
- Maintain a library of "safe patterns" for common scenarios (auth, file upload, API design).

### 13.2 Training

- Short workshops on secure coding basics and using AI tools safely.
- Emphasize: treat AI output as a starting point, not a finished product—review and understand before committing.

---

## 14. Recommended references (anchor standards)

- OWASP Top 10 (latest) — awareness and taxonomy.
- OWASP ASVS 5.0.0 — verifiable security requirements.
- Microsoft SDL — structured practices integrated into engineering lifecycle.
- Azure Well-Architected Security pillar — security design checklist and principles.
- NIST SSDF SP 800-218 — Secure Software Development Framework.

---

## References

1. OWASP Top 10 (project page) — <https://owasp.org/www-project-top-ten/>
2. OWASP Top 10:2025 (introduction + categories) — <https://owasp.org/Top10/2025/0x00_2025-Introduction/>
3. OWASP ASVS 5.0.0 (project page) — <https://owasp.org/www-project-application-security-verification-standard/>
4. OWASP ASVS GitHub (latest stable version info) — <https://github.com/OWASP/ASVS>
5. Microsoft Security Development Lifecycle (SDL) — <https://www.microsoft.com/en-us/securityengineering/sdl>
6. Microsoft SDL (practice overview) — <https://www.microsoft.com/en-us/securityengineering/sdl/practices>
7. Azure Well-Architected Framework — Security checklist — <https://learn.microsoft.com/en-us/azure/well-architected/security/checklist>
8. Azure Well-Architected — Establish a security baseline — <https://learn.microsoft.com/en-us/azure/well-architected/security/establish-baseline>
9. ASP.NET Core anti-forgery guidance — <https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery>
10. ASP.NET Core Data Protection configuration overview — <https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview>
11. Angular security best practices — <https://angular.dev/best-practices/security>
12. OWASP .NET Security Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/DotNet_Security_Cheat_Sheet.html>
13. Azure Key Vault + App Service tutorial (.NET) — <https://learn.microsoft.com/en-us/azure/key-vault/general/tutorial-net-create-vault-azure-web-app>
14. Managed identity best practice recommendations — <https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations>
15. GitHub Advanced Security for Azure DevOps (overview/config) — <https://learn.microsoft.com/en-us/azure/devops/repos/security/configure-github-advanced-security-features>
16. Azure DevOps dependency scanning (GHAzDO) — <https://learn.microsoft.com/en-us/azure/devops/repos/security/github-advanced-security-dependency-scanning>
17. Azure DevOps secret scanning (GHAzDO) — <https://learn.microsoft.com/en-us/azure/devops/repos/security/github-advanced-security-secret-scanning>
18. Defender for Cloud — DevOps recommendations reference — <https://learn.microsoft.com/en-us/azure/defender-for-cloud/recommendations-reference-devops>
19. NIST SSDF SP 800-218 — <https://csrc.nist.gov/pubs/sp/800/218/final>
