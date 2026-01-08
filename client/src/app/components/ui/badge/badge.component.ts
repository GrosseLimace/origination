import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-badge',
  standalone: true,
  template: `
    <span [class]="getClasses()">
      <ng-content />
    </span>
  `
})
export class BadgeComponent {
  @Input() variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' = 'default';
  @Input() class = '';

  getClasses(): string {
    const baseClasses = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors';

    const variantClasses: Record<string, string> = {
      default: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      secondary: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
      success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
      destructive: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
      outline: 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
    };

    return `${baseClasses} ${variantClasses[this.variant]} ${this.class}`;
  }
}
