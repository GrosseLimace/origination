import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-button',
  standalone: true,
  template: `
    <button
      [type]="type"
      [disabled]="disabled"
      [class]="getClasses()"
      (click)="onClick.emit($event)"
    >
      <ng-content />
    </button>
  `
})
export class ButtonComponent {
  @Input() variant: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' = 'default';
  @Input() size: 'default' | 'sm' | 'lg' | 'icon' = 'default';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() disabled = false;
  @Input() class = '';
  @Output() onClick = new EventEmitter<MouseEvent>();

  getClasses(): string {
    const baseClasses = 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:pointer-events-none disabled:opacity-50';

    const variantClasses: Record<string, string> = {
      default: 'bg-green-600 text-white hover:bg-green-700',
      primary: 'bg-green-600 text-white hover:bg-green-700',
      secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600',
      outline: 'border border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100',
      ghost: 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100',
      destructive: 'bg-red-600 text-white hover:bg-red-700'
    };

    const sizeClasses: Record<string, string> = {
      default: 'h-10 px-4 py-2',
      sm: 'h-8 px-3 text-sm',
      lg: 'h-12 px-6 text-lg',
      icon: 'h-10 w-10'
    };

    return `${baseClasses} ${variantClasses[this.variant]} ${sizeClasses[this.size]} ${this.class}`;
  }
}
