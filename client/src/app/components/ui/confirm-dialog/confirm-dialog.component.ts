import { Component, inject } from '@angular/core';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import {
  DialogComponent,
  DialogHeaderComponent,
  DialogTitleComponent,
  DialogDescriptionComponent,
  DialogFooterComponent
} from '../dialog/dialog.component';
import { ButtonComponent } from '../button/button.component';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogFooterComponent,
    ButtonComponent
  ],
  template: `
    <app-dialog
      [isOpen]="svc.isOpen()"
      [closeOnBackdrop]="false"
      [showCloseButton]="false"
      size="sm"
    >
      <app-dialog-header>
        <app-dialog-title>{{ svc.options().title }}</app-dialog-title>
        @if (svc.options().message) {
          <app-dialog-description>{{ svc.options().message }}</app-dialog-description>
        }
      </app-dialog-header>
      <app-dialog-footer>
        <app-button variant="outline" (onClick)="svc.resolve(false)">
          {{ svc.options().cancelLabel ?? 'Cancel' }}
        </app-button>
        <app-button
          [variant]="svc.options().variant === 'danger' ? 'destructive' : 'default'"
          (onClick)="svc.resolve(true)"
        >
          {{ svc.options().confirmLabel ?? 'Confirm' }}
        </app-button>
      </app-dialog-footer>
    </app-dialog>
  `
})
export class ConfirmDialogComponent {
  svc = inject(ConfirmDialogService);
}
