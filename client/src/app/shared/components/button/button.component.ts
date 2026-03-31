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
    const base = 'inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scoular-green disabled:pointer-events-none disabled:opacity-50';

    const variantMap: Record<string, string> = {
      default:     'bg-scoular-green-accessible text-white hover:bg-scoular-green',
      primary:     'bg-scoular-green-accessible text-white hover:bg-scoular-green',
      secondary:   'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600',
      outline:     'border border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100',
      ghost:       'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100',
      destructive: 'bg-scoular-red text-white hover:bg-scoular-red-accessible'
    };

    const sizeMap: Record<string, string> = {
      default: 'h-10 px-4 py-2',
      sm:      'h-8 px-3 text-sm',
      lg:      'h-12 px-6 text-lg',
      icon:    'h-10 w-10'
    };

    return [base, variantMap[this.variant()], sizeMap[this.size()], this.class()]
      .filter(Boolean).join(' ');
  }
}
