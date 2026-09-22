import { describe, it, expect, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { SelectComponent } from './select.component';

const OPTIONS = `<option value="corn">Corn</option><option value="soy">Soybeans</option>`;

// NgModel pushes model -> view on a resolved promise, and this component nests a second
// NgModel on the native <select>, so a form write needs: microtasks, a change-detection
// pass for the inner NgModel to see the new value, then its own microtask. The zoneless
// TestBed only refreshes dirty views, so mark the root before detecting a plain-property change.
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 0));
}

// Behavior-focused (style-guides/automated-testing.md §7.2/§7.4): the select is a
// ControlValueAccessor, so the contract under test is what a form sees and what the user
// sees in the native <select> — not the utility classes it applies.
describe('SelectComponent', () => {
  it('should render projected options inside an accessible combobox', async () => {
    await render(`<app-select>${OPTIONS}</app-select>`, { imports: [SelectComponent] });

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Corn', 'Soybeans']);
  });

  it('should show the placeholder as a disabled empty option selected until a value is written', async () => {
    const { fixture } = await render(`<app-select placeholder="Pick a commodity">${OPTIONS}</app-select>`, {
      imports: [SelectComponent],
    });
    await settle(fixture);

    const placeholder = screen.getByRole('option', { name: 'Pick a commodity' }) as HTMLOptionElement;
    expect(placeholder.disabled).toBe(true);
    expect(placeholder.value).toBe('');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });

  it('should not render a placeholder option when none is given', async () => {
    await render(`<app-select>${OPTIONS}</app-select>`, { imports: [SelectComponent] });

    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('should propagate the chosen option to the bound form model', async () => {
    const onChange = vi.fn();
    await render(`<app-select [ngModel]="''" (ngModelChange)="onChange($event)">${OPTIONS}</app-select>`, {
      imports: [SelectComponent, FormsModule],
      componentProperties: { onChange },
    });

    await userEvent.selectOptions(screen.getByRole('combobox'), 'soy');

    expect(onChange).toHaveBeenCalledWith('soy');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('soy');
  });

  it('should write a value from the form model into the native select', async () => {
    const { fixture } = await render(`<app-select [ngModel]="'soy'">${OPTIONS}</app-select>`, {
      imports: [SelectComponent, FormsModule],
    });
    await settle(fixture);

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('soy');
  });

  it('should disable the native select when the form disables the control', async () => {
    const { fixture } = await render(`<app-select [ngModel]="''" [disabled]="true">${OPTIONS}</app-select>`, {
      imports: [SelectComponent, FormsModule],
    });
    await settle(fixture);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('should treat a null form value as empty and toggle disabled through the CVA contract', async () => {
    const fixture = TestBed.createComponent(SelectComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.writeValue(null as unknown as string);
    expect(component.value).toBe('');

    // The disabled signal feeds the native select through its own NgModel, so it lands async.
    component.setDisabledState(true);
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('select')).toBeDisabled();

    component.setDisabledState(false);
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('select')).toBeEnabled();
  });

  it('should mark the control touched when the native select blurs', () => {
    const fixture = TestBed.createComponent(SelectComponent);
    const onTouched = vi.fn();
    fixture.componentInstance.registerOnTouched(onTouched);
    fixture.detectChanges();

    fireEvent.blur(fixture.nativeElement.querySelector('select'));

    expect(onTouched).toHaveBeenCalledTimes(1);
  });

  it('should keep the shared form styling and append caller classes to the native select', () => {
    const fixture = TestBed.createComponent(SelectComponent);
    fixture.componentRef.setInput('class', 'commodity-select');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.classList.contains('scoular-form-select')).toBe(true);
    expect(select.classList.contains('commodity-select')).toBe(true);
  });
});
