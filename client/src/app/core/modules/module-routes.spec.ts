import { describe, it, expect } from 'vitest';
import { permissionGuard } from '@core/access/permission.guard';
import { authGuard } from '@core/auth/auth.guard';
import { moduleRoutes } from './module-routes';

const page = () => Promise.resolve(class {});

describe('moduleRoutes', () => {
  it('gates a page that names permissions behind permissionGuard, which reads them from the route data', () => {
    const [route] = moduleRoutes([{ id: 'bid-sheet', routes: [{ path: 'bid-sheet', requires: ['bid-sheets:read'], loadComponent: page }] }]);

    expect(route.canMatch).toEqual([permissionGuard]);
    expect(route.data).toEqual({ requires: ['bid-sheets:read'] });
  });

  it('leaves a page that names none open to every signed-in user', () => {
    const [route] = moduleRoutes([{ id: 'help', routes: [{ path: 'help', requires: [], loadComponent: page }] }]);

    expect(route.canMatch).toBeUndefined();
    expect(route.data).toBeUndefined();
  });

  it('makes every page wait for sign-in, keeping the pages in the order given', () => {
    const routes = moduleRoutes([
      { id: 'customers', routes: [{ path: '', requires: [], loadComponent: page }] },
      { id: 'calculators' },
      {
        id: 'usage-analytics',
        routes: [
          { path: 'usage-dashboard', requires: ['usage-reports:read'], loadComponent: page },
          { path: 'usage-dashboard/users/:userId', requires: ['usage-reports:read'], loadComponent: page },
        ],
      },
    ]);

    expect(routes.map(r => r.path)).toEqual(['', 'usage-dashboard', 'usage-dashboard/users/:userId']);
    expect(routes.map(r => r.canActivate)).toEqual([[authGuard], [authGuard], [authGuard]]);
    expect(routes.map(r => r.loadComponent)).toEqual([page, page, page]);
  });
});
