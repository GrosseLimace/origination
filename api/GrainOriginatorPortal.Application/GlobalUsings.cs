// Mirrors the Web host's GlobalUsings.cs for the namespaces the moved files rely on implicitly.
// A Microsoft.NET.Sdk class library does not inherit the Web SDK's implicit usings, so these
// must be spelled out here. Deliberately omitted: Microsoft.AspNetCore.Mvc and
// Microsoft.AspNetCore.Authorization — nothing in this layer may depend on MVC types.

// System namespaces
global using System.Text.Json.Serialization;

// Microsoft namespaces
global using Microsoft.AspNetCore.Http;
global using Microsoft.Extensions.Configuration;
global using Microsoft.Extensions.DependencyInjection;
global using Microsoft.Extensions.Logging;

// Project namespaces
global using GrainOriginatorPortal.Api.Models;
global using GrainOriginatorPortal.Api.Models.Requests;
global using GrainOriginatorPortal.Api.Models.Responses;
// Infrastructure DbContexts. Entity types are NOT globally imported: code that touches an entity
// must `using …Infrastructure.Data.Entities;` explicitly so entity usage stays greppable.
global using GrainOriginatorPortal.Infrastructure.Data;
