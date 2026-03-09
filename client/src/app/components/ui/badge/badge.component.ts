import { Component, input } from '@angular/core';

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
  public variant = input<'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'danger' | 'outline' | 'primary'>('default');
  public class = input<string>('');

  public getClasses(): string {
    const variantMap: Record<string, string> = {
      default:     'scoular-badge-success',
      primary:     'scoular-badge-success',
      success:     'scoular-badge-success',
      secondary:   'scoular-badge-neutral',
      warning:     'scoular-badge-warning',
      destructive: 'scoular-badge-error',
      danger:      'scoular-badge-error',
      outline:     'scoular-badge-outline'
    };

    return ['scoular-badge', variantMap[this.variant()], this.class()]
      .filter(Boolean).join(' ');
  }
}
