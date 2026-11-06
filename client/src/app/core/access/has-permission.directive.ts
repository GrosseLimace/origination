import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';

import { PermissionId } from './permission-ids.generated';
import { PermissionService } from './permission.service';

/**
 * Renders its content only when the user holds the permission, or every permission in a list:
 *
 * ```html
 * <button *appHasPermission="'notes:write'" (click)="addNote()">Add note</button>
 * ```
 *
 * The control is removed rather than disabled. The content appears once permissions have loaded,
 * and goes again if they change. The API checks the same permission, so this only spares the user
 * a control that would be refused.
 */
@Directive({ selector: '[appHasPermission]' })
export class HasPermissionDirective {
  readonly appHasPermission = input.required<PermissionId | readonly PermissionId[]>();

  private readonly template = inject(TemplateRef);
  private readonly container = inject(ViewContainerRef);
  private readonly access = inject(PermissionService);
  private shown = false;

  constructor() {
    effect(() => {
      const required = this.appHasPermission();
      const allowed = this.access.hasAll(typeof required === 'string' ? [required] : required);
      if (allowed && !this.shown) {
        this.container.createEmbeddedView(this.template);
      } else if (!allowed && this.shown) {
        this.container.clear();
      }
      this.shown = allowed;
    });
  }
}
