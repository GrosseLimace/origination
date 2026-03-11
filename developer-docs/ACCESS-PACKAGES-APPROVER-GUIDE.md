# Origination Access Packages - Approver Guide

This guide explains how to approve access requests, perform direct assignments, and conduct quarterly access reviews for Origination.

## Contents

- [Quick Links](#quick-links)
- [Your Role as Approver](#your-role-as-approver)
- [Who Should Have Access](#who-should-have-access)
- [Access Packages](#access-packages)
- [Approving Self-Service Requests](#approving-self-service-requests)
- [Direct Assignment (No Request Flow)](#direct-assignment-no-request-flow)
- [Quarterly Access Reviews](#quarterly-access-reviews)
- [Removing Access](#removing-access)
- [Viewing Current Assignments](#viewing-current-assignments)
- [Access Package Configuration](#access-package-configuration)
- [Managing the Approver Group](#managing-the-approver-group)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Quick Links

| Action | Link |
|--------|------|
| Approve/Deny Requests | [My Access - Approvals](https://myaccess.microsoft.com/#/access-packages/approvals) |
| Manage Access Packages | [Azure Portal - Identity Governance](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmEntitlement) |
| Direct Assignment | [Azure Portal - Access Packages](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmAccessPackages) |
| Access Reviews | [Azure Portal - Access Reviews](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmAccessReviews) |

---

## Your Role as Approver

As a member of the **Access Package Managers - App Dev** group, you can:

1. **Approve/Deny** self-service access requests for Origination
2. **Directly assign** users to access packages (no request flow)
3. **Conduct quarterly reviews** of all Origination access grants
4. **Remove access** from users who no longer need it

---

## Who Should Have Access

These access packages are intended for team members who **review code, merge pull requests, and deploy** Origination. Not everyone contributing to the project needs an access package.

**Approve requests from:**
- Code reviewers who merge pull requests
- Team members who deploy the application
- Developers who need direct Azure resource access (App Service, Key Vault, SQL)
- Team members who need Maintainer or Deployer access on the GitHub repository

**Question requests from:**
- Users who only push branches (standard GitHub contributor access is separate)
- End users of the application (they don't need infrastructure access)
- Users who can't clearly explain why they need infrastructure-level access

**Redirect to General Users:** If someone requests the **GitHub - Origination Maintainer** package but only needs basic GitHub Enterprise access (e.g., to view repos or participate in discussions), deny the request and direct them to the **GitHub - General Users** package instead. General Users provides standard GHE access without Maintainer or Deployer permissions.

When reviewing requests and quarterly reviews, use this criteria to decide whether access is appropriate.

---

## Origination Access Packages

| Package | Who Can Request | What It Grants |
|---------|-----------------|----------------|
| **Origination - Developer Azure Access** | Admin accounts and IT members | Dev/QA environments, SQL dev/qa permissions, **Owner + Member of Dev/QA User groups** |
| **Origination - Azure Production Support** | Admin accounts only | Production environment, SQL prod permissions |
| **GitHub - Origination Maintainer** | IT members (regular account) | GHE Maintainers + Deployers teams |

> **Note:** Developer Azure Access grants **Owner + Member** roles on the Dev and QA User groups. As Member, developers can access the Dev/QA applications. As Owner, they can self-manage who else has application access via [Groups I Own](https://myaccount.microsoft.com/groups/groups-i-own), reducing the need for approver intervention for routine user additions.

---

## Approving Self-Service Requests

When a user requests access to Origination, you'll receive an email notification.

### Via Email

1. Click the link in the approval email
2. Review the request details and business justification
3. Click **Approve** or **Deny**
4. Provide a justification for your decision (required)

### Via My Access Portal

1. Go to [My Access - Approvals](https://myaccess.microsoft.com/#/access-packages/approvals)
2. Sign in with your regular account (`username@scoular.com`)
3. Review pending requests for Origination
4. Click on a request to see details
5. Click **Approve** or **Deny**
6. Provide a justification

### Approval Criteria

Consider these factors when approving:

- Does the user have a legitimate business need for Origination access?
- Is the requested access level appropriate for their role?
- Is the justification clear and reasonable?

**Note:** Requests not acted upon within 14 days are automatically denied.

---

## Direct Assignment (No Request Flow)

Use direct assignment to proactively grant Origination access without requiring users to submit a request.

### Step 1: Navigate to Access Packages

1. Go to [Azure Portal - Access Packages](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmAccessPackages)
2. Sign in with your regular account (`username@scoular.com`)

### Step 2: Find the Origination Package

1. Click **Catalogs** in the left menu
2. Select the catalog containing Origination
3. Click **Access packages**
4. Click on the package (e.g., "Origination - Developer Azure Access")

### Step 3: Assign Users

1. Click **Assignments** in the left menu
2. Click **+ New assignment**
3. Search for and select the user(s)
4. Set the assignment duration:
   - **Tip: Leave end date blank** to use the maximum 180 days (recommended)
   - You can set a shorter duration (e.g., 2 weeks for a contractor)
   - **Maximum: 180 days**
5. Click **Add**

> **Warning:** The Azure Portal UI does not prevent you from entering a duration longer than 180 days. If you exceed the maximum, the assignment will submit but then **automatically deny**. Leave the end date blank to safely default to 180 days.

**Important:** When assigning Azure Production Support, assign to the user's **admin account** (`admin-username@scoular.com`). Developer Azure Access can be assigned to either admin or regular accounts.

---

## Quarterly Access Reviews

Access reviews use a **dual-reviewer model**. Both users AND approvers receive notifications simultaneously. Either party can complete the review.

### How It Works

1. Every 90 days, a review cycle opens for all Origination assignments
2. **Both** users AND the Access Package Managers - App Dev receive notification emails on Day 1
3. Either party can complete the review at any time during the 30-day window
4. Approvers can **override** user decisions if needed
5. If **no one responds** within 30 days, access is **automatically removed**

### Timeline

| Event | Timing |
|-------|--------|
| Review opens | Every 3 months |
| Initial notification | Day 1 (users AND approvers) |
| Mid-cycle reminder | ~Day 15 (if pending) |
| Near-deadline reminder | ~Day 27 (if pending) |
| Review closes | Day 30 |

### Your Role During Reviews

As an approver, you receive notifications for **all** assignments, not just users who haven't responded:

1. Click the link in the review email, OR go to [Azure Portal - Access Reviews](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmAccessReviews)
2. Review the list of users with Origination access
3. For each user:
   - **Approve** -- if they still need access
   - **Deny** -- if they no longer need access or have left the team
4. You can override a user's self-review decision if you disagree

### What Happens

| Scenario | Result |
|----------|--------|
| User confirms they need access | Access continues |
| User indicates they don't need access | Access removed |
| Approver approves (regardless of user action) | Access continues |
| Approver denies (can override user) | Access removed |
| **No one responds within 30 days** | **Access removed** |

This ensures access doesn't persist indefinitely without active confirmation.

### Review Frequency

| Package | Review Frequency |
|---------|------------------|
| Origination - Developer Azure Access | Quarterly (90 days) |
| Origination - Azure Production Support | Quarterly (90 days) |
| GitHub - Origination Maintainer | Quarterly (90 days) |

---

## Removing Access

### From Access Review

During quarterly reviews, deny access for users who no longer need Origination.

### Manual Removal

1. Go to [Azure Portal - Access Packages](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmAccessPackages)
2. Navigate to the catalog and Origination package
3. Click **Assignments**
4. Find the user and click **Remove**

---

## Viewing Current Assignments

### All Assignments for a Package

1. Go to [Azure Portal - Access Packages](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmAccessPackages)
2. Navigate to the catalog and Origination package
3. Click **Assignments**
4. View all active, expired, and pending assignments

### Export Assignment List

1. From the Assignments view
2. Click **Download** to export to CSV
3. Use for auditing or record-keeping

---

## Access Package Configuration

### Package Settings

| Setting | Value |
|---------|-------|
| Maximum Access Duration | 180 days |
| Self-Service Requests | Fixed 180-day duration |
| Direct Assignments | Flexible, up to 180 days max |
| Access Reviews | Quarterly (every 90 days), dual-reviewer model (user + approvers notified simultaneously) |
| Review Window | 30 days to respond |
| Review Non-Response | Remove access (if no one responds within 30 days) |

### Policies Per Package

Each Origination package has two policies:

| Policy | Purpose | Approval |
|--------|---------|----------|
| Self-Service Request | Users request for themselves | Requires your approval |
| Admin Direct Assignment | You assign users directly | Auto-approved (no approval needed) |

---

## Managing the Approver Group

The Access Package Managers - App Dev group controls who can approve Origination access requests.

### Adding/Removing Approvers

1. Go to [Azure Portal - Groups](https://portal.azure.com/#view/Microsoft_AAD_IAM/GroupsManagementMenuBlade/~/AllGroups)
2. Search for "Access Package Managers - App Dev"
3. Click **Members**
4. Add or remove members as needed

All group members can:
- Approve/deny requests for Origination
- Perform direct assignments
- Conduct access reviews

---

## Best Practices

1. **Respond promptly** - Don't let requests sit for days
2. **Require clear justification** - Ask for more details if the business need is unclear
3. **Respond to reviews promptly** - Review assignments during the 30-day window to prevent unintended access removal
4. **Use direct assignment** - For team onboarding, assign access proactively
5. **Remove access promptly** - When someone leaves the team or project
6. **Focus on reviewers and deployers** - Access packages are for code reviewers and deployers, not all project contributors
7. **Let developers self-manage non-prod users** - Developers with Developer Access can add QA testers and stakeholders to Dev/QA User groups themselves

---

## Troubleshooting

### I don't see approval requests

- Ensure you're a member of the Access Package Managers - App Dev group
- Check your email spam folder for notifications
- Sign in with your regular account (not admin account)

### I can't perform direct assignments

- Verify you have the Catalog Reader and Assignment Manager roles
- These roles are granted through the Access Package Managers - App Dev group membership

### My direct assignment was auto-denied

- You likely exceeded the 180-day maximum duration
- The Azure Portal UI allows entering longer durations but enforces the limit after submission
- Resubmit with an end date within 180 days of the start date

### I didn't receive a review notification

- Review notifications are sent to all members of Access Package Managers - App Dev when a review cycle opens
- Check your email spam folder
- Check [Azure Portal - Access Reviews](https://portal.azure.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/elmAccessReviews) for pending reviews
- If no review cycles are showing, contact IT Infrastructure

---

## Questions?

Contact IT Infrastructure if you have questions about managing Origination access packages.

---

*Document version: 1.2 | 2026-02-18*
