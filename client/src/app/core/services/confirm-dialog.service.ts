import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

@Injectable({
  providedIn: 'root'
})
export class ConfirmDialogService {
  private _resolve: ((value: boolean) => void) | null = null;

  isOpen = signal(false);
  options = signal<ConfirmOptions>({ title: '' });

  confirm(opts: ConfirmOptions): Promise<boolean> {
    this.options.set(opts);
    this.isOpen.set(true);
    return new Promise<boolean>(resolve => {
      this._resolve = resolve;
    });
  }

  resolve(confirmed: boolean): void {
    this.isOpen.set(false);
    this._resolve?.(confirmed);
    this._resolve = null;
  }
}
