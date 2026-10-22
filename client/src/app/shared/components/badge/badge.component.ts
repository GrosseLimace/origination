import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="getClasses()">
      <ng-content />
    </span>
  `
})
export class BadgeComponent {
  public variant = input<'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'danger' | 'outline' | 'primary'>('default');
  public class = input<string>('');

  public getClasses(): string {
    const base = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors';

    const variantMap: Record<string, string> = {
      default:     'bg-scoular-green/10 text-scoular-green-accessible dark:bg-scoular-green/20 dark:text-scoular-green',
      primary:     'bg-scoular-green-accessible text-white',
      success:     'bg-scoular-green/10 text-scoular-green-accessible dark:bg-scoular-green/20 dark:text-scoular-green',
      secondary:   'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
      warning:     'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
      destructive: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
      danger:      'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
      outline:     'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
    };

    return [base, variantMap[this.variant()], this.class()]
      .filter(Boolean).join(' ');
  }
}
