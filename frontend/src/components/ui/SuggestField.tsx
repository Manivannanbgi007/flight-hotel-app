import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import { FieldChrome, type FieldChromeProps } from './Field';
import { describedBy, useFieldIds } from './fieldIds';
import { controlClass } from './fieldStyles';
import { FloatingPanel } from './FloatingPanel';

export interface Suggestion {
  /** Put into the field when chosen. */
  value: string;
  /** Second line, e.g. "7 hotels". */
  description?: ReactNode;
}

export interface SuggestFieldProps extends FieldChromeProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Suggestions for what is typed (load them from `value`); free text stays allowed. */
  suggestions: Suggestion[];
  /** A small decorative icon inside the field, on the left. */
  icon?: ReactNode;
  className?: string;
}

/**
 * Free text with suggestions under it (a city while typing a destination). Nothing is picked for the person: Enter
 * submits what they typed unless they moved to a suggestion with ↓/↑. Works with react-hook-form through `Controller`.
 */
export const SuggestField = forwardRef<HTMLInputElement, SuggestFieldProps>(function SuggestField(
  { label, hint, error, optional, id, value, onChange, onBlur, name, placeholder, disabled, suggestions, icon, className },
  ref,
) {
  const ids = useFieldIds(id);
  const listId = `${ids.controlId}-suggestions`;
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const text = value ?? '';
  // Hide the list once the text is exactly the only suggestion (it was just chosen or typed in full).
  const settled = suggestions.length === 1 && suggestions[0]?.value.toLowerCase() === text.trim().toLowerCase();
  const expanded = open && suggestions.length > 0 && !settled;

  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, active, listId]);

  const choose = (suggestion: Suggestion) => {
    onChange(suggestion.value);
    setOpen(false);
    setActive(-1);
  };

  const onType = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
    setOpen(true);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const last = suggestions.length - 1;
      setActive((index) =>
        event.key === 'ArrowDown' ? (index >= last ? 0 : index + 1) : index <= 0 ? last : index - 1,
      );
    } else if (event.key === 'Enter' && expanded && active >= 0 && suggestions[active]) {
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  const onWrapperBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setOpen(false);
    setActive(-1);
    onBlur?.();
  };

  return (
    <FieldChrome {...ids} label={label} hint={hint} error={error} optional={optional}>
      <div ref={anchorRef} className="relative" onBlur={onWrapperBlur}>
        {icon && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-role-600 [&>svg]:size-4">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={ids.controlId}
          name={name}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error, hint, ids.hintId, ids.errorId)}
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={text}
          onChange={onType}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(controlClass(Boolean(error)), icon && 'pl-10', className)}
        />
        {expanded && (
          <FloatingPanel anchor={anchorRef} onDismiss={() => setOpen(false)} matchWidth className="max-h-72">
            <ul
              id={listId}
              role="listbox"
              aria-label="Suggestions"
              onMouseDown={(event) => event.preventDefault()}
              className="flex flex-col gap-0.5"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onClick={() => choose(suggestion)}
                  onPointerEnter={() => setActive(index)}
                  className={cn(
                    'flex cursor-pointer flex-col rounded-lg px-3 py-2 text-sm transition-colors duration-(--duration-fast)',
                    index === active ? 'bg-role-50' : 'hover:bg-slate-50',
                  )}
                >
                  <span className="font-semibold text-slate-900">{suggestion.value}</span>
                  {suggestion.description && <span className="text-xs text-slate-500">{suggestion.description}</span>}
                </li>
              ))}
            </ul>
          </FloatingPanel>
        )}
      </div>
    </FieldChrome>
  );
});
