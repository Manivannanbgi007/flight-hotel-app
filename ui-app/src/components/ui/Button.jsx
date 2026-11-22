import { forwardRef } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';

import { buttonClass } from './buttonStyles';

/** The app's button: primary (default), accent, secondary, ghost, danger, role (portal accent) or link. */
export const Button = forwardRef(function Button(
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
export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }) {
  return <Link className={buttonClass({ variant, size, className })} {...rest} />;
}
