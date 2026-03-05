# Grain Originator Portal

A comprehensive web application for grain originators to manage customers, contracts, deliveries, and more.

## Architecture

This project has been converted from Blazor Server to a modern Angular + .NET Web API architecture:

```
GrainOriginatorPortal/
├── api/                          # .NET Web API Backend
│   └── GrainOriginatorPortal.Api/
│       ├── Controllers/          # REST API endpoints
│       ├── Models/               # Data models
│       ├── Services/             # Business logic
│       └── Program.cs            # Entry point
│
└── client/                       # Angular Frontend
    └── src/
        └── app/
            ├── components/       # Reusable UI components
            ├── pages/            # Route pages
            ├── services/         # HTTP services
            └── models/           # TypeScript interfaces
```

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) (LTS version recommended)
- npm (comes with Node.js)

## Getting Started

### 1. Start the API

```bash
cd api/GrainOriginatorPortal.Api
dotnet run
```

The API will start at `http://localhost:5000`

### 2. Start the Angular Client

```bash
cd client
npm install      # First time only
npm start
```

The client will start at `http://localhost:4200`

### 3. Open in Browser

Navigate to `http://localhost:4200` to use the application.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/customers` | GET | Get all customers |
| `/api/customers/{id}` | GET | Get customer by ID |
| `/api/customers/{id}` | PUT | Update customer |
| `/api/farms` | GET | Get all farms |
| `/api/farms/customer/{customerId}` | GET | Get farms by customer |
| `/api/contracts` | GET | Get all contracts |
| `/api/contracts/customer/{customerId}` | GET | Get contracts by customer |
| `/api/tickets` | GET | Get all tickets |
| `/api/plantingintentions` | GET | Get all planting intentions |
| `/api/notes` | GET | Get all notes |
| `/api/notes` | POST | Create a note |
| `/api/storedgrain` | GET | Get all stored grain |
| `/api/savedlists` | GET | Get all saved lists |
| `/api/savedlists` | POST | Create a saved list |
| `/api/savedlists/{id}` | DELETE | Delete a saved list |

## Features

- **Customer Management**: View and manage customer profiles, contacts, and information
- **Contract Tracking**: Monitor contracts, delivery windows, and pricing
- **Natural Language Queries**: Build customer lists using plain English queries
- **Dark Mode**: Toggle between light and dark themes
- **Mobile Responsive**: Works on desktop and mobile devices
- **Insights Dashboard**: View actionable insights and key metrics

## Technology Stack

### Backend
- .NET 10
- ASP.NET Core Web API
- CORS enabled for Angular dev server

### Frontend
- Angular 19
- Tailwind CSS
- RxJS for state management
- Leaflet for maps (optional)

## Development

### API Development

```bash
cd api/GrainOriginatorPortal.Api
dotnet watch run  # Hot reload
```

### Angular Development

```bash
cd client
npm start         # Dev server with hot reload
npm run build     # Production build
```

## License

MIT

---

## Software Bill of Materials (SBOM)
Last Updated: 2026-03-05

### Backend Dependencies (.NET / C#)
| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| Azure.Identity | 1.17.1 | MIT | Azure credential/identity support |
| Microsoft.AspNetCore.OpenApi | 10.0.1 | MIT | OpenAPI/Swagger endpoint |
| Microsoft.Data.SqlClient | 6.1.4 | MIT | SQL Server data access driver |
| Microsoft.EntityFrameworkCore.Design | 10.0.1 | MIT | EF Core tooling (design-time only) |
| Microsoft.EntityFrameworkCore.SqlServer | 10.0.1 | MIT | EF Core SQL Server provider |
| Microsoft.Identity.Web | 4.5.0 | MIT | Azure AD JWT bearer authentication |

### Frontend Dependencies (Angular / TypeScript)
| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| @angular/animations | ^19.0.0 | MIT | Angular animation support |
| @angular/common | ^19.0.0 | MIT | Common Angular utilities and HTTP client |
| @angular/core | ^19.0.0 | MIT | Angular core framework |
| @angular/forms | ^19.0.0 | MIT | Reactive and template-driven forms |
| @angular/platform-browser | ^19.0.0 | MIT | Browser platform support |
| @angular/router | ^19.0.0 | MIT | Client-side routing |
| @azure/msal-angular | ^5.1.1 | MIT | MSAL Angular integration and interceptor |
| @azure/msal-browser | ^5.4.0 | MIT | Azure AD browser authentication (PKCE) |
| leaflet | ^1.9.4 | BSD-2-Clause | Interactive map rendering |
| rxjs | ~7.8.0 | Apache-2.0 | Reactive programming / observables |
| tslib | ^2.3.0 | 0BSD | TypeScript runtime helpers |
| zone.js | ~0.15.0 | MIT | Angular change detection |
