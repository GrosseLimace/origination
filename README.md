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

## Mock Data

The API uses `MockDataService` which provides sample data for development. To connect to a real database:

1. Implement `IDataService` with Entity Framework Core or another data access method
2. Register the new service in `Program.cs`

## License

MIT
