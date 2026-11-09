import {
  forwardRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, Eye, EyeOff, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';
import { describedBy, useFieldIds } from './fieldIds';
import { checkboxClass, controlClass, selectClass } from './fieldStyles';

export interface FieldChromeProps {
  label: ReactNode;
  /** Shown under the field when there is no error. */
  hint?: ReactNode;
  error?: string;
  /** Marks the label "(optional)"; required is the default for our forms. */
  optional?: boolean;
}

/** Label, hint and error around a control; custom controls (DateField, TimeField, ...) use it to match. */
export function FieldChrome({
  controlId,
  labelId,
  hintId,
  errorId,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: FieldChromeProps & {
  controlId: string;
  labelId?: string;
  hintId: string;
  errorId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label id={labelId} htmlFor={controlId} className="text-sm font-semibold text-slate-800">
        {label}
        {optional && <span className="font-normal text-slate-500"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger-600">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export type TextFieldProps = FieldChromeProps & InputHTMLAttributes<HTMLInputElement> & {
  /**
   * A decorative icon at the start of the field (`icon={Mail}`): grey, in the portal colour while the field has focus.
   * The label still names the field; the icon is hidden from screen readers.
   */
  icon?: LucideIcon;
};

/**
 * The leading icon of a field. `text-current` on the svg keeps the generated icon colours (icon-colors.css) off it, so
 * it follows this wrapper's grey and turns to the portal colour inside a focused `group`.
 */
function FieldIcon({ icon: Icon, invalid }: { icon: LucideIcon; invalid: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center transition-colors duration-(--duration-fast)',
        invalid ? 'text-danger-600' : 'text-slate-400 group-focus-within:text-role-600',
      )}
    >
      <Icon className="size-[1.125rem] text-current" />
    </span>
  );
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optional, id, className, icon, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  const input = (
    <input
      ref={ref}
      id={ids.controlId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(error, hint, ids.hintId, ids.errorId)}
      className={cn(controlClass(!!error), icon && 'pl-10', className)}
      {...rest}
    />
  );
  return (
    <FieldChrome {...ids} label={label} hint={hint} error={error} optional={optional}>
      {icon ? (
        <div className="group relative">
          <FieldIcon icon={icon} invalid={!!error} />
          {input}
        </div>
      ) : (
        input
      )}
    </FieldChrome>
  );
});

/** Password input with a show/hide button. */
export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type'>>(function PasswordField(
  { label, hint, error, optional, id, className, icon, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  const [visible, setVisible] = useState(false);
  return (
    <FieldChrome {...ids} label={label} hint={hint} error={error} optional={optional}>
      <div className="group relative">
        {icon && <FieldIcon icon={icon} invalid={!!error} />}
        <input
          ref={ref}
          id={ids.controlId}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error, hint, ids.hintId, ids.errorId)}
          className={cn(controlClass(!!error), icon && 'pl-10', 'pr-11', className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="absolute inset-y-1 right-1 flex items-center rounded-lg px-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </FieldChrome>
  );
});

export type SelectFieldProps = FieldChromeProps & SelectHTMLAttributes<HTMLSelectElement>;

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, optional, id, className, children, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  return (
    <FieldChrome {...ids} label={label} hint={hint} error={error} optional={optional}>
      <select
        ref={ref}
        id={ids.controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, ids.hintId, ids.errorId)}
        className={cn(selectClass(!!error), className)}
        {...rest}
      >
        {children}
      </select>
    </FieldChrome>
  );
});

export type TextAreaFieldProps = FieldChromeProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line text (messages, notes). */
export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, hint, error, optional, id, className, rows = 4, ...rest },
  ref,
) {
  const ids = useFieldIds(id);
  return (
    <FieldChrome {...ids} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        ref={ref}
        id={ids.controlId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, hint, ids.hintId, ids.errorId)}
        className={cn(controlClass(!!error), 'resize-y', className)}
        {...rest}
      />
    </FieldChrome>
  );
});

export const CheckboxField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; error?: string }
>(function CheckboxField({ label, error, id, className, ...rest }, ref) {
  const ids = useFieldIds(id);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <input
          ref={ref}
          id={ids.controlId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.errorId : undefined}
          className={cn(checkboxClass, 'mt-px', className)}
          {...rest}
        />
        <label htmlFor={ids.controlId} className="text-sm text-slate-700">
          {label}
        </label>
      </div>
      {error && (
        <p id={ids.errorId} className="text-sm font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
});
