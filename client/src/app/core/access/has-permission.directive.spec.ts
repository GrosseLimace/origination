import { describe, it, expect } from 'vitest';
import { Component } from '@angular/core';
import { render, screen } from '@testing-library/angular';

import { permissionStub, providePermissions } from '@testing/permission.stub';
import { HasPermissionDirective } from './has-permission.directive';

@Component({
  imports: [HasPermissionDirective],
  template: `
    <button *appHasPermission="'notes:write'">Add note</button>
    <button *appHasPermission="['saved-lists:read:team', 'saved-lists:write:team']">Assign list</button>
    <p>Always here</p>
  `,
})
class Host {}

describe('HasPermissionDirective', () => {
  async function renderWith(stub = permissionStub()) {
    const view = await render(Host, { providers: [providePermissions(stub)] });
    return { view, stub };
  }

  it('removes a control the user lacks the permission for, rather than disabling it', async () => {
    await renderWith();

    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
    expect(screen.getByText('Always here')).toBeTruthy();
  });

  it('renders the control when the user holds the permission', async () => {
    await renderWith(permissionStub(['notes:write']));

    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();
  });

  it('with a list, renders only when the user holds every permission', async () => {
    const { view, stub } = await renderWith(permissionStub(['saved-lists:read:team']));
    expect(screen.queryByRole('button', { name: 'Assign list' })).toBeNull();

    stub.grant('saved-lists:read:team', 'saved-lists:write:team');
    view.fixture.detectChanges();

    expect(screen.getByRole('button', { name: 'Assign list' })).toBeTruthy();
  });

  it('shows the control once permissions load, and removes it if they change', async () => {
    const { view, stub } = await renderWith();

    stub.grant('notes:write');
    view.fixture.detectChanges();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();

    stub.grant();
    view.fixture.detectChanges();
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
  });

  it('renders the control once, however often it re-checks', async () => {
    const { view, stub } = await renderWith(permissionStub(['notes:write']));

    stub.grant('notes:write', 'notes:read');
    view.fixture.detectChanges();

    expect(screen.getAllByRole('button', { name: 'Add note' })).toHaveLength(1);
  });
});
