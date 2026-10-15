# Mobile app — running it locally

Sign-in is shared with the desktop, as Burdi's driver app shares Burdi's (decided 2026-10-15): the phone app
uses the desktop **Origination - Dev** SPA registration and the `Origination.Application.Dev` scope, and the API
accepts them on the mobile routes because `Mobile:SharedSignIn` is on in the base appsettings. So the committed
configuration runs as-is; no borrowed sign-in and no environment-variable override any more.

## Steps

1. **API** (port 5000, the committed `environment.ts` default):
   ```bash
   cd api/GrainOriginatorPortal.Api
   dotnet run --launch-profile http
   ```
   Requires `az login` (local SQL auth is Azure CLI based) and Dev ODS access. Check the log for
   `Mobile surface enabled: … sign-in shared with the desktop (Burdi model)`.
2. **App:** `cd client && npx ng serve origination-mobile` (port 4201, already a redirect URI on the Dev
   registration), then open `http://localhost:4201` in Chrome, F12 → device toolbar → Pixel 7 or iPhone 14.

## When 5000 is taken by another worktree

Run the API on another port (e.g. `ASPNETCORE_URLS=http://localhost:5003`, a port local CORS already lists) and
point `apiBaseUrl` in `client/projects/mobile/src/environments/environment.ts` at it **without committing that
edit** — the Vitest environment guard fails while it is in place, which is the guard working. Restore with
`git checkout -- client/projects/mobile/src/environments/environment.ts`.

## Caveats

- Browser device emulation only: Entra allows plain-http redirect URIs on `localhost` only, so a real phone on
  the LAN cannot sign in against a local run. A real phone needs the deployed Dev site at `/mobile` (on the
  Scoular network) once `/mobile` is on the Dev registration (PLATFORM-REQUESTS.md E3).
- Starting the API locally runs the customer sync job against Dev on startup, exactly like the desktop's local
  run; check the log for `0 deactivated`.
- **Schema drift:** producer-details reads fail if the Dev database is ahead of or behind this branch's
  migrations (feature branches apply theirs to Dev). The Overview shows its error state.
- DP contracts are empty in Dev by design (data exists only in Prod ODS).
