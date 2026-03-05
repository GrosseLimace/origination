# Origination — Network Diagram

How your app connects to the network and what outbound destinations are available.

## Table of Contents

- [How Your App Connects](#how-your-app-connects)
- [Outbound Connections (What Your App Can Reach)](#outbound-connections-what-your-app-can-reach)
- [Inbound Connections (How Users Reach Your App)](#inbound-connections-how-users-reach-your-app)
- [Subnet Details](#subnet-details)
- [Need an Outbound Exception?](#need-an-outbound-exception)

---

## How Your App Connects

Your app runs on Azure App Service with two dedicated subnets per environment:

```
  +-----------------------------+
  |  Inbound Subnet             |
  |  Private Endpoints:         |
  |    - App Service PE         |
  |    - Key Vault PE           |
  +-------------+---------------+
                |
       VNet Integration
                |
  +-------------v---------------+
  |  Outbound Subnet            |
  |  (App Service egress)       |
  |                             |
  |  Controls:                  |
  |  - Zero-trust NSG           |
  |    (explicit allowlist)     |
  |  - Route table              |
  |    (defense-in-depth)       |
  |  - Entra ID service         |
  |    endpoint                 |
  +-----------------------------+
```

All outbound traffic is controlled by a **zero-trust Network Security Group (NSG)**. Only explicitly allowed destinations are reachable — everything else is blocked by default.

---

## Outbound Connections (What Your App Can Reach)

The following destinations are allowed from your app. Private endpoint (PE) IPs are automatically resolved at deploy time — you don't need to manage them.

| # | Destination | Protocol/Port | How It Connects | Purpose |
|---|-------------|--------------|-----------------|---------|
| 1 | **SQL Database** | TDS/1433 | Private endpoint on SQL server | Origination database (all environments) |
| 2 | **Key Vault** | HTTPS/443 | Private endpoint on inbound subnet | Secret storage (`kv-origination{-env}-eus`) |
| 3 | **API Management (APIM)** | HTTPS/443 | Private endpoint(s) | Gateway for internal and external APIs |
| 4 | **Microsoft Entra ID** | HTTPS/443 | Service endpoint (Azure backbone) | OAuth2/OIDC authentication, managed identity tokens |
| 5 | **Azure Monitor** | HTTPS/443 | Service tag | Application Insights telemetry |
| 6 | **DNS Resolver** | DNS/53 | Private DNS resolver (`10.102.1.10`) | Name resolution for private endpoints and `scoular.com` |
| 7 | **Docstore Storage** | HTTPS/443 | Private endpoint (if configured) | Direct blob retrieval from docstore storage account |

> **ODS Database:** This app also has read-only access to the **ODS** (Operational Data Store) database on the same SQL server. ODS access uses the same private endpoint — no additional NSG rules are needed.

### What's Blocked

**Everything not in the table above is blocked.** Specifically:

- All RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) not explicitly allowed
- All internet-bound traffic
- Direct access to Azure PaaS services not routed through private endpoints

If traffic somehow bypasses the NSG (misconfiguration), two additional layers catch it:
1. **Route table** — forces leaked traffic to the FortiGate firewall instead of the internet
2. **FortiGate deny rules** — catch-all deny in the firewall

### SQL Server Endpoints

| Environment | SQL Server | Databases |
|-------------|-----------|-----------|
| Dev | `azrscosqld01.database.windows.net` | Origination, ODS (read-only) |
| QA | `azrscosqlq01.database.windows.net` | Origination, ODS (read-only) |
| Prod | `azrscosqlp01.database.windows.net` | Origination, ODS (read-only) |

All SQL connections use **Managed Identity** — no passwords in connection strings.

> **Note:** APIM is the gateway for calling internal and external APIs. If your app calls APIs through APIM (e.g., `apidev.scoular.com`, `apiqa.scoular.com`, `api.scoular.com`), no additional NSG rules are needed — the APIM private endpoint IPs are already allowed. Docstore's API is also accessed via APIM; the direct storage endpoint is for optional blob retrieval.

---

## Inbound Connections (How Users Reach Your App)

### Private-Only App

Your app is only reachable from the **corporate network** (VPN, ExpressRoute, or direct Azure VNet access). There is no public internet endpoint.

Users connect via the app's private endpoint, which resolves through Azure Private DNS:

```
  Corporate Network / VPN
       |
       v
  Azure VNet (private routing)
       |
       v
  Private Endpoint -> App Service
```

The private endpoint IP is only routable from within the Scoular network — external users cannot reach it.

### CI/CD Deployments (All Environments)

GitHub Actions deploys your app via the SCM/Kudu endpoint (`*.scm.azurewebsites.net`). This resolves to the private endpoint via Azure Private DNS — deployments reach the app directly without traversing the firewall.

---

## Subnet Details

| Environment | Inbound Subnet | Outbound Subnet | Custom Domain |
|-------------|----------------|-----------------|---------------|
| Dev | `10.103.25.80/28` | `10.103.25.96/28` | `origination-dev.scoular.com` |
| QA | `10.103.25.112/28` | `10.103.25.128/28` | `origination-qa.scoular.com` |
| Prod | `10.102.25.48/28` | `10.102.25.64/28` | `origination.scoular.com` |

---

## Need an Outbound Exception?

If your app needs to reach a destination not in the allowed list (e.g., a new API, an external service, a storage account), contact the **Infrastructure team**.

**What to provide:**

1. **Destination** — IP address or FQDN of the service
2. **Port** — TCP port number (usually 443 for HTTPS or 1433 for SQL)
3. **Reason** — brief description of why the connection is needed
4. **Environments** — which environments need the access (dev, qa, prod, or all)

**What happens:**

The Infrastructure team adds a `customOutboundRule` to your app's `app-config.json`. This creates an NSG rule in the P100-P199 priority range that allows the specific destination. The rule applies to **all environments** (dev, qa, and prod).

**Example custom rule (for reference):**

```json
{
  "name": "AllowExternalApiOutbound",
  "description": "Allow HTTPS to partner API endpoint",
  "priority": 100,
  "protocol": "Tcp",
  "destinationPortRange": "443",
  "destinationAddressPrefix": "203.0.113.10/32"
}
```

After the rule is added, Infrastructure runs a deployment to apply the change.

---

*Document version: 1.1 | 2026-03-04*
