import { Injectable, signal } from '@angular/core';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  message: string;
}

/** Inline banners rendered by the shell. Auto-dismisses info; errors stay until dismissed. */
@Injectable({ providedIn: 'root' })
export class NoticeService {
  private readonly _items = signal<Notice[]>([]);
  readonly items = this._items.asReadonly();
  private nextId = 1;

  error(message: string): void {
    this.push('error', message);
  }

  info(message: string, autoDismissMs = 4000): void {
    const id = this.push('info', message);
    setTimeout(() => this.dismiss(id), autoDismissMs);
  }

  dismiss(id: number): void {
    this._items.update((items) => items.filter((n) => n.id !== id));
  }

  private push(kind: Notice['kind'], message: string): number {
    const id = this.nextId++;
    this._items.update((items) => [...items.filter((n) => n.message !== message), { id, kind, message }]);
    return id;
  }
}
