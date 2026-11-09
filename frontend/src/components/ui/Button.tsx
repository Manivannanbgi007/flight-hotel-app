import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Loader2 } from 'lucide-react';

import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button (prevents double submits). */
  loading?: boolean;
}

/** The app's button: primary (default), accent, secondary, ghost, danger, role (portal accent) or link. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

/** A router link that looks like a button (navigation, not an action). */
export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return <Link className={buttonClass({ variant, size, className })} {...rest} />;
}
