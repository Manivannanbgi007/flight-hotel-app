import { FlaskConical } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

/** DEMO flights are never mixed with real ones without this label (SUPPLIER_INTEGRATION.md section 3). */
export function DemoInventoryBadge() {
  return (
    <Badge tone="warning">
      <FlaskConical className="size-3" aria-hidden="true" /> Demo inventory
    </Badge>
  );
}

/** A rounded tile with the airline's IATA code (the demo airlines have no logo files). */
export function AirlineMark({ code, name, size = 'md' }: { code: string; name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 font-bold tracking-tight text-brand-700 ring-1 ring-inset ring-brand-200/70',
        size === 'sm' ? 'size-8 text-xs' : 'size-11 text-sm',
      )}
      role="img"
      aria-label={name}
    >
      {code}
    </span>
  );
}
