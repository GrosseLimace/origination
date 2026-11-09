// System namespaces
global using System.Text.Json.Serialization;

// Microsoft namespaces
global using Microsoft.AspNetCore.Authorization;
global using Microsoft.AspNetCore.Http;
global using Microsoft.AspNetCore.Mvc;
global using Microsoft.Extensions.Logging;

// Project namespaces
// Infrastructure DbContexts (DiagnosticsController only — every other controller goes through a
// service). Entity types are NOT globally imported: Api code that touches an entity (mappings,
// services constructing entities for writes) must `using` the entity namespace explicitly, so entity
// usage in the Api layer is greppable. Repository interfaces live in each module's or Platform area's
// Interfaces namespace, never its Repositories namespace.
global using GrainOriginatorPortal.Infrastructure.Data;
