import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-button',
  standalone: true,
  template: `
    <button
      [type]="type()"
      [disabled]="disabled()"
      [class]="getClasses()"
      (click)="onClick.emit($event)"
    >
      <ng-content />
    </button>
  `
})
export class ButtonComponent {
  public variant = input<'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'>('default');
  public size = input<'default' | 'sm' | 'lg' | 'icon'>('default');
  public type = input<'button' | 'submit' | 'reset'>('button');
  public disabled = input<boolean>(false);
  public class = input<string>('');
  public onClick = output<MouseEvent>();

  public getClasses(): string {
    if (this.size() === 'icon') {
      return ['scoular-btn-icon', this.class()].filter(Boolean).join(' ');
    }

    const variantMap: Record<string, string> = {
      default:     'scoular-btn-primary',
      primary:     'scoular-btn-primary',
      secondary:   'scoular-btn-secondary',
      outline:     'scoular-btn-outline',
      ghost:       'scoular-btn-ghost',
      destructive: 'scoular-btn-danger'
    };

    const sizeMap: Record<string, string> = {
      default: '',
      sm:      'scoular-btn-sm',
      lg:      'scoular-btn-lg'
    };

    return ['scoular-btn', variantMap[this.variant()], sizeMap[this.size()], this.class()]
      .filter(Boolean).join(' ');
  }
}
