# customers-from-graphql - Questions for User

Owned and appended to only by the orchestrator, per `ORCHESTRATION.md`. Subagents return candidate questions in their final message; they never write this file directly -- only the orchestrator appends.

Entry format per question: the question; who raised it (role + fresh/resumed); what it is blocked on (or "non-blocking"); and, once resolved, the answer and date.

## Goal statement (written at kickoff, 2026-10-06, before planning)

The Origination Workbench still gets its customer (producer) data from the ODS, a scheduled copy of CTRM: a nightly sync fills our own Customer and CustomerTradeUnit tables from the ODS view `originations.vw_CustomerTradeUnits` and `base.vw_CurrentCustomers`, the add-a-customer search queries `base.vw_CurrentCustomers`, the per-request customer access check reads the ODS view live, and the ACH badge reads `base.Customer.PaymentMethod`. Contracts and tickets already moved to the Scoular GraphQL gateway on 2026-10-06. The goal is for the Workbench to no longer depend on the ODS for customers: the same customers, the same trade-unit membership (which the ODS derives from a customer's contracts and tickets, not from a customer attribute), the same screens, with the switch reversible by a configuration setting and with no bulk deactivation of customers if the new source returns a partial or bad answer. Our existing customer IDs, which notes, contacts and saved lists hang off, must survive unchanged. Not all needed fields exist in the GraphQL customer type yet (email, extended address, NOP ID, payment method, duplicate flag were requested from the API team on 2026-10-05), so the work must be deliverable in stages: everything provable on today's schema first, the remaining fields when they land.

## Open questions

### Q1
- **Question:** Is ODS base.Contract.IsActive an ETL current-row flag (plan assumption D2: links are append-only) or a business flag? If business, prioritise the customer/trade-unit pairs query (E6) with the API team.
- **Raised by:** planner (fresh, hand-off 1)
- **Blocks:** non-blocking for Stage 1; decides how much to trust append-only links
- **Answer:** (open)

### Q2
- **Question:** Guard defaults: abort a sync that would deactivate more than 5% or more than 500 active customers/links. OK?
- **Raised by:** planner (fresh, hand-off 1)
- **Blocks:** non-blocking (config defaults)
- **Answer:** (open)

### Q3
- **Question:** Does GraphQL name or merchandisingName equal ODS CustomerName? (the compare report will show once permission lands)
- **Raised by:** planner (fresh, hand-off 1)
- **Blocks:** non-blocking; answered empirically
- **Answer:** (open)

### Q4
- **Question:** Keep cancelled/consolidated tickets in trade-unit discovery (view parity) or exclude them?
- **Raised by:** planner (fresh, hand-off 1)
- **Blocks:** non-blocking; default = parity (keep)
- **Answer:** (open)

### Q5
- **Question:** When Customers.Read.All lands: flip Dev via App Service setting (CustomerSync__Source=ctrm) or appsettings.Dev.json?
- **Raised by:** planner (fresh, hand-off 1)
- **Blocks:** non-blocking
- **Answer:** (open)

### Q6
- **Question:** Pin a sourceSystem value (e.g. CTRM) on the customer lookup?
- **Raised by:** planner (fresh, hand-off 1)
- **Blocks:** non-blocking; API team says sourceCode alone is the join key
- **Answer:** (open)

### Q7
- **Question:** Confirm the ODS feeder may adopt minted customers by ScoularId (first time the ODS path matches on anything but id). Mentor: this makes flipping back to ods safe once minted ids carry notes in PROD — answer before the first PROD ctrm run.
- **Raised by:** planner + mentor (fresh)
- **Blocks:** blocks the first PROD CustomerSync:Source=ctrm run, not Stage 1 build
- **Answer:** (open)

### Q8
- **Question:** Weekly compare in Dev/QA for several weeks after the switch to detect deviation D-1 (links that ODS would drop but append-only keeps). Who runs it?
- **Raised by:** mentor (fresh, hand-off 2)
- **Blocks:** non-blocking
- **Answer:** (open)

### Q9
- **Question:** Does the App Service's managed identity (app-origination-dev-eus / -qa-eus / -eus) have UPDATE permission on the new sequence dbo.CustomerIdSequence in the Origination database? db_datawriter does not cover sequences. Repo docs only list the deploy pipeline identity's roles (db_datareader, db_datawriter, db_ddladmin, EXECUTE). Check in SSMS per environment after the migration lands: list the app identity's roles with `sys.database_role_members`, or run `SELECT HAS_PERMS_BY_NAME('dbo.CustomerIdSequence','OBJECT','UPDATE')` as that identity. If missing: `GRANT UPDATE ON OBJECT::dbo.CustomerIdSequence TO [<app identity>];`
- **Raised by:** reviewer (fresh, task-review of B3a)
- **Blocks:** the first NON-dry CTRM sync that mints a new customer id in each environment (dry runs and the ODS path never touch the sequence)
- **Answer:** (open)

### Q10
- **Question:** Does the ODS view `base.vw_CurrentCustomers` contain any inactive customers? Run in SSMS against ODS: `SELECT COUNT(*) FROM base.vw_CurrentCustomers WHERE IsActive = 0;` If the answer is 0, the GraphQL sync must not keep inactive manual producers either (a one-line change before the flip); if it is more than 0, the current behaviour already matches the ODS.
- **Raised by:** planner (resumed, hand-off 3, C4 parity gap Q2)
- **Blocks:** the first `CustomerSync:Source=ctrm` run in each environment, not the build
- **Answer:** (open)

### Q11
- **Question:** Before the first GraphQL sync in each environment, run the pre-flip checks in plan §10 ("Before the first `ctrm` run in each environment"): padded trade-unit count and the duplicate-spelling query (must return 0 rows), and a dry run with `source=ctrm` showing zero manual-customer deactivations.
- **Raised by:** planner (resumed, hand-off 3)
- **Blocks:** the first `ctrm` run in each environment
- **Answer:** (open)

### Status note (2026-10-06, afternoon)
- **Customers.Read.All is GRANTED on the nonprod client** (scoular-graphql-client-nonprod). Verified by the user through the local API's `ctrm-probe`: permission granted, totalCount 302596, projectionAccepted true, sampleFound true (SMITFAR), idKind String. PROD client not yet checked.
