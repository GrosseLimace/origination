// System namespaces
global using System.Text.Json.Serialization;

// Microsoft namespaces
global using Microsoft.AspNetCore.Authorization;
global using Microsoft.AspNetCore.Http;
global using Microsoft.AspNetCore.Mvc;
global using Microsoft.Extensions.Logging;

// Project namespaces
global using GrainOriginatorPortal.Api.Models;
global using GrainOriginatorPortal.Api.Models.Requests;
global using GrainOriginatorPortal.Api.Models.Responses;
// Infrastructure DbContexts (DiagnosticsController only — every other controller goes through a
// service). Entity types are NOT globally imported: Api code that touches an entity (mappings,
// services constructing entities for writes) must `using …Infrastructure.Data.Entities;` explicitly,
// so entity usage in the Api layer is greppable. Repository contract types live in
// …Infrastructure.Abstractions, never the impl namespace …Infrastructure.Repositories.
global using GrainOriginatorPortal.Infrastructure.Data;
