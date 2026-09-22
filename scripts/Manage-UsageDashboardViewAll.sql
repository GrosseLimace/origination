/*
    Usage Dashboard — whole-org viewer list
    =======================================
    Table: dbo.UsageDashboardViewAllUsers   (Origination database, per environment)

    People in this table get the MANAGER DROPDOWN on the Usage Dashboard and can pick any
    manager to see that manager's whole reporting subtree. Everyone else who can open the
    dashboard is scoped to themselves plus their own reports, with the dropdown hidden.

    This is NOT the list of who may open the dashboard at all — that is membership of the
    "Origination App {Env} Super Users" Entra group, which surfaces as the Admin app role.
    Someone must already be in that group for a row here to do anything.

    Changes take effect within ~60 seconds (the API caches the list for a minute). No
    redeploy and no App Service restart. The person whose access changed then needs a
    BROWSER REFRESH, because the SPA decides whether to draw the dropdown from /api/me,
    which it only calls at page load.

    UserId is the short name — the UPN before the '@', e.g. "CEgr". Matching is
    case-insensitive. Always fill in Reason and CreatedBy: this row widens what someone can
    see, and those two columns are the only audit trail of who granted it and why.

    Run against each environment separately (Dev / QA / PROD).
*/

-- ── 1. Who has whole-org access today? ────────────────────────────────────────
SELECT  Id, UserId, Reason, CreatedBy, CreatedAt
FROM    dbo.UsageDashboardViewAllUsers
ORDER BY UserId;


-- ── 2. Grant whole-org access ─────────────────────────────────────────────────
-- Edit the three values, then run. The WHERE NOT EXISTS makes it safe to re-run.
/*
INSERT INTO dbo.UsageDashboardViewAllUsers (UserId, Reason, CreatedBy)
SELECT  'ShortName',                -- e.g. 'JSmith'
        'Why they need whole-org',  -- e.g. 'Ops leadership'
        'YourShortName'             -- who is granting it
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.UsageDashboardViewAllUsers WHERE UserId = 'ShortName'
);
*/


-- ── 3. Revoke whole-org access ────────────────────────────────────────────────
-- They keep full access to the app and to the dashboard; they just go back to seeing
-- themselves plus their own reports.
/*
DELETE FROM dbo.UsageDashboardViewAllUsers
WHERE UserId = 'ShortName';
*/
