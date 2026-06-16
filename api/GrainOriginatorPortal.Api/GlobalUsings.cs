// System namespaces
global using System.Text.Json.Serialization;

// Microsoft namespaces
global using Microsoft.AspNetCore.Authorization;
global using Microsoft.AspNetCore.Http;
global using Microsoft.AspNetCore.Mvc;
global using Microsoft.Extensions.Logging;

// Project namespaces
global using GrainOriginatorPortal.Api.Interfaces;
global using GrainOriginatorPortal.Api.Models;
global using GrainOriginatorPortal.Api.Models.Requests;
global using GrainOriginatorPortal.Api.Models.Responses;
// Infrastructure layer — entities + DbContexts resolved by short name (temporary; Phase 3
// removes entity references from the Api layer).
global using GrainOriginatorPortal.Infrastructure.Data;
global using GrainOriginatorPortal.Infrastructure.Data.Entities;
// Domain result enums (AssignTradeUnitsResult / DeactivateTradeUnitResult) live here.
global using GrainOriginatorPortal.Infrastructure.Repositories;
