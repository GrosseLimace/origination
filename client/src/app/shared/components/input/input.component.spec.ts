import { describe, it, expect, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { fireEvent, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { InputComponent } from './input.component';

// NgModel pushes model -> view (value and disabled) on a resolved promise; wait it out and
// re-run change detection so the native <input> reflects the write. The zoneless TestBed
// only refreshes dirty views, so mark the root before detecting a plain-property change.
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 0));
}

// Behavior-focused (style-guides/automated-testing.md §7.2/§7.4): the input is a
// ControlValueAccessor with a clearable affordance and a date-picker shortcut. We assert
// what a form and the user observe on the native <input>, not the utility classes.
describe('InputComponent', () => {
  function create(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(InputComponent);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    const native = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    return { fixture, component: fixture.componentInstance, native };
  }

  it('should render a text input by default with the given placeholder', () => {
    const { native } = create({ placeholder: 'Search producers' });

    expect(screen.getByPlaceholderText('Search producers')).toBe(native);
    expect(native.type).toBe('text');
    expect(native).toBeEnabled();
  });

  it('should forward type, inputmode and maxlength to the native input', () => {
    const { native } = create({ type: 'tel', inputmode: 'numeric', maxlength: 10 });

    expect(native.type).toBe('tel');
    expect(native).toHaveAttribute('inputmode', 'numeric');
    expect(native).toHaveAttribute('maxlength', '10');
  });

  it('should omit inputmode and maxlength attributes when they are not set', () => {
    const { native } = create();

    expect(native.hasAttribute('inputmode')).toBe(false);
    expect(native.hasAttribute('maxlength')).toBe(false);
  });

  it('should notify the registered onChange as the user types', async () => {
    const { component, native } = create();
    const onChange = vi.fn();
    component.registerOnChange(onChange);

    await userEvent.type(native, 'Acme');

    expect(onChange).toHaveBeenLastCalledWith('Acme');
    expect(component.value).toBe('Acme');
  });

  it('should write a form value into the native input and treat null as empty', async () => {
    const { fixture, component, native } = create();

    component.writeValue('Acme Farms');
    await settle(fixture);
    expect(native.value).toBe('Acme Farms');

    component.writeValue(null as unknown as string);
    await settle(fixture);
    expect(component.value).toBe('');
    expect(native.value).toBe('');
  });

  it('should mark the control touched when the native input blurs', () => {
    const { component, native } = create();
    const onTouched = vi.fn();
    component.registerOnTouched(onTouched);

    fireEvent.blur(native);

    expect(onTouched).toHaveBeenCalledTimes(1);
  });

  it('should disable the native input and hide the clear button when the form disables it', async () => {
    const { fixture, component, native } = create({ clearable: true });
    component.writeValue('Acme');
    component.setDisabledState(true);
    await settle(fixture);

    expect(native).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('should show the Clear button only while there is a value, and clear on click', async () => {
    const { fixture, component, native } = create({ clearable: true });
    const onChange = vi.fn();
    component.registerOnChange(onChange);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();

    await userEvent.type(native, 'Acme');
    fixture.detectChanges();
    const clear = screen.getByRole('button', { name: 'Clear' });

    await userEvent.click(clear);
    await settle(fixture);

    expect(onChange).toHaveBeenLastCalledWith('');
    expect(component.value).toBe('');
    expect(native.value).toBe('');
    expect(native).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('should never render a Clear button when clearable is off, even with a value', async () => {
    const { fixture, native } = create();

    await userEvent.type(native, 'Acme');
    fixture.detectChanges();

    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('should open the native picker on click for date inputs', () => {
    const { native } = create({ type: 'date' });
    const showPicker = vi.fn();
    (native as HTMLInputElement & { showPicker: () => void }).showPicker = showPicker;

    fireEvent.click(native);

    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('should leave text inputs alone on click and swallow a picker that throws', () => {
    const text = create({ type: 'text' });
    const textPicker = vi.fn();
    (text.native as HTMLInputElement & { showPicker: () => void }).showPicker = textPicker;
    fireEvent.click(text.native);
    expect(textPicker).not.toHaveBeenCalled();

    const date = create({ type: 'date' });
    (date.native as HTMLInputElement & { showPicker: () => void }).showPicker = () => {
      throw new Error('already open');
    };
    expect(() => fireEvent.click(date.native)).not.toThrow();
  });
});
