# Origination Access Packages - User Guide

This guide explains how to request access to Origination environments using Entra ID Access Packages.

## Contents

- [Quick Links](#quick-links)
- [Who Should Request Access](#who-should-request-access)
- [Available Access Packages](#available-access-packages)
- [How to Request Access](#how-to-request-access)
- [Renewing Your Access](#renewing-your-access)
- [Checking Your Current Access](#checking-your-current-access)
- [Removing Your Access](#removing-your-access)
- [Quarterly Access Reviews](#quarterly-access-reviews)
- [Troubleshooting](#troubleshooting)

---

## Quick Links

| Action | Link |
|--------|------|
| Request Access | [My Access Portal](https://myaccess.microsoft.com) |
| View My Current Access | [My Access - Access Packages](https://myaccess.microsoft.com/#/access-packages/all) |
| Check Request Status | [My Access - Request History](https://myaccess.microsoft.com/#/access-packages/request-history) |

---

## Who Should Request Access

Not everyone who works on Origination needs to request an access package. These packages grant **infrastructure-level** access to Azure resources, SQL databases, and GitHub repository settings.

**You should request access if you:**
- Review pull requests or merge code for Origination
- Deploy the application to Azure environments
- Need direct access to Azure resources (App Service, Key Vault, SQL)
- Need Maintainer or Deployer access on the GitHub repository

**You do NOT need an access package if you:**
- Only write code and push branches (standard GitHub contributor access is separate)
- Only use the application as an end user
- Only need to view dashboards or reports

If you're unsure, check with the Access Package Managers - App Dev before requesting.

---

## Available Access Packages

Origination has three access packages:

| Package | What It Grants | Who Can Request |
|---------|----------------|-----------------|
| **Origination - Developer Azure Access** | Dev/QA environments, SQL dev/qa permissions, **membership + ownership of Dev/QA User groups** | Admin accounts and IT members |
| **Origination - Azure Production Support** | Production environment, SQL prod permissions | Admin accounts only |
| **GitHub - Origination Maintainer** | GHE repository access (Maintainers + Deployers teams) | IT members (regular accounts) |

**Important:** Azure Production Support must be requested with your **admin account** (`admin-username@scoular.com`). Developer Azure Access and GitHub Maintainer access can be requested with your **regular account** (`username@scoular.com`).

> **Self-service group management:** Developer Azure Access grants you **Owner + Member** of the Dev and QA User groups. As a Member, you can access the Dev/QA applications. As an Owner, you can add or remove users (e.g., QA testers, business stakeholders) directly at [myaccount.microsoft.com/groups/groups-i-own](https://myaccount.microsoft.com/groups/groups-i-own) -- no admin needed.

---

## How to Request Access

### Step 1: Go to My Access Portal

Open [https://myaccess.microsoft.com](https://myaccess.microsoft.com)

Sign in with the appropriate account:
- For Azure Production Support: Use your **admin account** (`admin-username@scoular.com`)
- For Developer Azure Access or GitHub Maintainer access: Use your **regular account** (`username@scoular.com`) or admin account

### Step 2: Browse Available Packages

1. Click **Access packages** in the left menu
2. Search for "**Origination**"
3. Click on the package name to view details

### Step 3: Request Access

1. Click **Request access**
2. Provide a **business justification** explaining why you need this access
3. Click **Submit**

### Step 4: Wait for Approval

- Your request is sent to the Access Package Managers - App Dev group for approval
- You'll receive an email when your request is approved or denied
- Approval typically takes 1-2 business days
- If not approved within 14 days, the request is automatically denied

### Step 5: Access Granted

Once approved:
- Group memberships are automatically assigned
- You can access the Origination environments
- Access is valid for **180 days**
- **Developer Access only:** You become an **Owner + Member** of the Dev and QA User groups. As Member, you can access the apps. As Owner, you can manage members at [Groups I Own](https://myaccount.microsoft.com/groups/groups-i-own).

---

## Renewing Your Access

Access expires after 180 days. You have two ways to maintain access:

### Quarterly Review Email (Recommended)

Every 90 days, you'll receive an **email from Microsoft** asking you to confirm you still need access. This is your easiest path to renewal:

1. Click the link in the review email
2. Confirm that you still need access to Origination
3. Provide a brief justification if prompted

**Important:** Both you AND the Access Package Managers - App Dev receive review notifications simultaneously. Either party can complete the review. If **no one** responds within 30 days, your access will be automatically removed.

### Manual Re-Request

If your access has expired or you missed the review window, submit a new request:

1. Go to [My Access Portal](https://myaccess.microsoft.com)
2. Search for the Origination access package
3. Click **Request access** and provide a business justification
4. The request follows the same approval process as the original request

**Tip:** Respond to review emails promptly to avoid losing access.

---

## Checking Your Current Access

### View Active Access

1. Go to [My Access - Access Packages](https://myaccess.microsoft.com/#/access-packages/all)
2. Click the **Active** tab
3. See all packages you currently have access to, with expiration dates

### View Request History

1. Go to [My Access - Request History](https://myaccess.microsoft.com/#/access-packages/request-history)
2. See status of pending, approved, and denied requests

---

## Removing Your Access

If you no longer need access to Origination:

1. Go to [My Access Portal](https://myaccess.microsoft.com)
2. Click **Access packages** > **Active**
3. Find the Origination package you want to remove
4. Click **Remove access**

This immediately revokes your group memberships.

---

## Quarterly Access Reviews

Every 90 days, a review cycle opens for Origination access. Both you AND the Access Package Managers - App Dev receive notifications simultaneously. **Either party can complete the review.**

### What to Expect

1. You receive an email with the subject "Review your access to Origination"
2. Click the link in the email to open the review in My Access
3. Confirm you still need access, or indicate you no longer need it
4. Provide a brief justification for your response

### Timeline

| Event | Timing |
|-------|--------|
| Review opens | Every 3 months |
| Initial notification | Day 1 (to you AND approvers) |
| Mid-cycle reminder | ~Day 15 (if still pending) |
| Near-deadline reminder | ~Day 27 (if still pending) |
| Review closes | Day 30 |

### What Happens

| Scenario | Result |
|----------|--------|
| You confirm you need access | Access continues |
| You indicate you no longer need access | Access is removed |
| Approver reviews (even if you don't) | Approver's decision applies |
| **No one responds within 30 days** | **Access is automatically removed** |

**Note:** The approver group can override your decision if needed. If you select "Keep access" but an approver selects "Remove access," the approver's decision may take precedence.

**Bottom line:** Respond to the review email promptly to keep your access. If you ignore it and no approver acts within 30 days, you lose access and will need to submit a new request.

---

## Troubleshooting

### I can't find the Origination access package

- Ensure you're signed in with the correct account (admin vs. regular)
- **Azure Production Support**: Only visible to admin accounts
- **Developer Azure Access**: Visible to Admin accounts and IT members
- **GitHub Maintainer**: Only visible to IT members (regular accounts)
- Search for "Origination" in the catalog

### My request was denied

- Contact the Access Package Managers - App Dev for clarification
- Ensure your business justification clearly explains why you need access
- You can submit a new request with additional justification

### I lost access unexpectedly

- Your access may have expired (180-day maximum)
- A quarterly review may have closed without anyone responding (access is removed after 30 days if no one responds)
- An approver may have denied your access during a review (approvers can override user decisions)
- Submit a new request through the My Access portal to regain access

### I have Azure access but can't use GHE

You need a separate GitHub access package requested with your **regular account** (not admin account):

- **GitHub - Origination Maintainer** -- for code reviewers and deployers who need Maintainer/Deployer access to the repository
- **GitHub - General Users** -- for team members who need basic GitHub Enterprise access but aren't code reviewers or deployers (e.g., project managers, QA testers reviewing PRs)

---

## Questions?

Contact the Access Package Managers - App Dev or IT support if you have questions about Origination access packages.

---

*Document version: 1.3 | 2026-08-11*
