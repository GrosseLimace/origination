# Mobile app — local preview before the mobile registration exists

Until Infrastructure creates the `Origination External - Dev` registration (PLATFORM-REQUESTS.md E3)
and Identity creates the `Origination.Mobile.Dev` scope (E9), the phone app cannot sign in with its
own identity. This recipe borrows the **desktop Dev** registration and scope so the real screens can be
exercised against the local API and Dev data. Nothing here is committed; it is config only.

## Steps

1. **Ports.** Use ports the desktop Dev SPA registration already allows and local CORS already lists:
   the app on `4201` (or `4202`), the API on `5003`. Leave `4200`/`5000` alone if another session is using them.
2. **Temporary environment** — edit `client/projects/mobile/src/environments/environment.ts` (do NOT commit):
   - `apiBaseUrl: 'http://localhost:5003/api/mobile/v1'`
   - `msal.clientId: 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff'` (desktop Dev SPA)
   - `msal.redirectUri` / `postLogoutRedirectUri: 'http://localhost:4201'`
   - `apiScopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev']` (desktop scope)
3. **API** with the desktop scope accepted on the mobile routes (env var, not appsettings):
   ```bash
   cd api/GrainOriginatorPortal.Api
   ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5003 \
   Mobile__RequiredScopes__0=Origination.Application.Dev \
   dotnet bin/Release/net10.0/GrainOriginatorPortal.Api.dll
   ```
   Requires `az login` (local SQL auth is Azure CLI based) and Dev ODS access.
4. **App:** `cd client && npx ng serve origination-mobile --port 4201`, then open `http://localhost:4201`
   in Chrome, F12 → device toolbar → Pixel 7 or iPhone 14.
5. **Finish:** stop both processes and `git checkout -- client/projects/mobile/src/environments/environment.ts`.
   The Vitest environment guard fails while the preview edit is in place — that is the guard working.

## Caveats seen on 2026-09-23

- Browser device emulation only: Entra allows plain-http redirect URIs on `localhost` only, so a real
  phone on the LAN cannot sign in against this setup. A real phone needs the Dev Static Web App (E1).
- The preview API instance accepts the desktop scope on mobile routes, which also makes every desktop
  token look like a mobile token to *that instance*; the desktop app must keep using its own API on 5000.
- Starting the API locally runs the customer sync job against Dev on startup, exactly like the desktop's local run.
- **Schema drift:** producer-details reads fail if the Dev database is ahead of or behind `main`'s
  migrations (feature branches apply theirs to Dev). The producer header degrades gracefully
  (customer-level contact only); the On-farm tab shows its error state.
- DP contracts are empty in Dev by design (data exists only in Prod ODS).
