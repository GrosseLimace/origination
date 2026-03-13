# Testing Guide

## Test Projects

### API Tests — `api/GrainOriginatorPortal.Api.Tests/`
xUnit + Moq. Run with:
```bash
cd api
dotnet test
```

#### Test Files

| File | What it covers |
|------|---------------|
| `ControllerAuthorizationTests.cs` | Verifies every controller has `[Authorize]` — security regression test |
| `Controllers/CustomersControllerTests.cs` | GetAll, GetById, Search, GetBySourceId — happy path and 404 |
| `Controllers/NotesControllerTests.cs` | Create, GetByCustomer, Delete |
| `Controllers/PlantingIntentionsControllerTests.cs` | Create, GetByCustomer, Update, Delete |
| `Middleware/GlobalExceptionHandlerTests.cs` | Verifies NotFoundException → 404, ValidationException → 422, unhandled → 500 |
| `NotesControllerTests.cs` _(root)_ | Earlier version — superseded by `Controllers/` subfolder |
| `PlantingIntentionsControllerTests.cs` _(root)_ | Earlier version — superseded by `Controllers/` subfolder |
| `SavedListsControllerTests.cs` _(root)_ | SavedList CRUD |

#### Test Structure
Each controller test:
- Creates a `Mock<IDataService>`
- Instantiates the controller directly (no HTTP pipeline)
- Asserts status codes and response bodies

#### Coverage Gaps (known)
- No integration tests (no real DB)
- No Angular unit tests beyond `api.service.spec.ts`
- `StoredGrainController`, `DiagnosticsController`, `GeocodeController` not unit tested
- `SqlDataService` not tested (requires live SQL connection)

---

### Angular Tests — `client/src/app/`
Karma + Jasmine. Run with:
```bash
cd client
ng test
```

| File | What it covers |
|------|---------------|
| `services/api.service.spec.ts` | HTTP calls, error handling, base URL config |

---

## Running All Tests

```bash
# API
cd api && dotnet test --logger "console;verbosity=normal"

# Angular (headless)
cd client && ng test --watch=false --browsers=ChromeHeadless
```
