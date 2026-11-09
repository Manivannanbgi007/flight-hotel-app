import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Globe2, IdCard, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { BoardingPassIllustration } from '@/components/illustrations';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { countryName } from '@/lib/countries';
import { formatDate } from '@/lib/format';
import { accountApi } from './accountApi';
import { SectionHeader } from './AccountLayout';
import { PassengerForm } from './PassengerForm';
import type { Passenger } from './types';
import { usePassengers } from './useAccount';

const MAX_PASSENGERS = 20;
const TYPE_LABELS = { ADULT: 'Adult', CHILD: 'Child', INFANT: 'Infant' } as const;

/** "new" while adding, a passenger id while editing that passenger. */
type Editing = 'new' | string | null;

export function PassengersPage() {
  const passengers = usePassengers();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);

  const onSaved = (saved: Passenger, added: boolean) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.account.passengers });
    setEditing(null);
    toast.success(added ? `${saved.firstName} was added.` : `${saved.firstName} was updated.`);
  };

  const count = passengers.data?.length ?? 0;
  const full = count >= MAX_PASSENGERS;

  return (
    <div>
      <SectionHeader
        title="Saved passengers"
        description="Save the people you travel with to fill in bookings faster."
        action={
          editing !== 'new' && (
            <Button onClick={() => setEditing('new')} disabled={full || passengers.isPending}>
              <Plus className="size-4" aria-hidden="true" />
              Add passenger
            </Button>
          )
        }
      />
      {full && (
        <p className="mb-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          You have saved the maximum of {MAX_PASSENGERS} passengers. Remove one to add another.
        </p>
      )}

      {editing === 'new' && (
        <Card variant="elevated" className="mb-5 border-t-4 border-t-brand-500 p-5 animate-scale-in sm:p-6">
          <h3 className="mb-4 text-base font-bold text-slate-900">New passenger</h3>
          <PassengerForm onSaved={(saved) => onSaved(saved, true)} onCancel={() => setEditing(null)} />
        </Card>
      )}

      {passengers.isPending && <LoadingState label="Loading your saved passengers…" rows={2} />}
      {passengers.isError && (
        <ErrorState
          description={ApiError.from(passengers.error).message}
          correlationId={ApiError.from(passengers.error).correlationId}
          onRetry={() => void passengers.refetch()}
        />
      )}
      {passengers.isSuccess && count === 0 && editing !== 'new' && (
        <EmptyState
          illustration={<BoardingPassIllustration className="w-44" />}
          title="No saved passengers yet"
          description="Add yourself and the people you often travel with. Passport details are optional and stored encrypted."
        />
      )}
      {passengers.isSuccess && count > 0 && (
        <ul className="grid gap-4 stagger xl:grid-cols-2" aria-label="Saved passengers">
          {passengers.data.map((passenger) => (
            <li key={passenger.id} className={editing === passenger.id ? 'xl:col-span-2' : undefined}>
              {editing === passenger.id ? (
                <Card variant="elevated" className="border-t-4 border-t-brand-500 p-5 sm:p-6">
                  <PassengerForm passenger={passenger} onSaved={(saved) => onSaved(saved, false)} onCancel={() => setEditing(null)} />
                </Card>
              ) : (
                <PassengerCard passenger={passenger} onEdit={() => setEditing(passenger.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PassengerCard({ passenger, onEdit }: { passenger: Passenger; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => accountApi.deletePassenger(passenger.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.account.passengers });
      toast.success(`${passenger.firstName} was removed.`);
    },
  });
  const name = `${passenger.firstName} ${passenger.lastName}`;

  const born = passenger.dateOfBirth ? `Born ${formatDate(passenger.dateOfBirth)}` : null;
  const nationality = passenger.nationality ? countryName(passenger.nationality) : null;

  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <Avatar name={name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-base font-bold text-slate-900">{name}</h3>
            <Badge tone="brand">{TYPE_LABELS[passenger.passengerType]}</Badge>
          </div>
          <p className="mt-1 flex items-start gap-2 text-sm text-slate-600">
            {nationality ? <Globe2 className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" /> : <CalendarDays className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />}
            <span>{[born, nationality].filter(Boolean).join(' · ') || 'No date of birth or nationality saved'}</span>
          </p>
          <p className="mt-1 flex items-start gap-2 text-sm text-slate-600">
            <IdCard className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span>
              {passenger.hasPassport
                ? `Passport ${passenger.passportNumberMasked}, ${countryName(passenger.passportCountry)}, valid until ${
                    passenger.passportExpiry ? formatDate(passenger.passportExpiry) : '—'
                  }`
                : 'No passport saved'}
            </span>
          </p>
          {remove.isError && <p role="alert" className="mt-2 text-sm text-danger-600">{ApiError.from(remove.error).message}</p>}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {confirming ? (
          <>
            <span className="mr-auto text-sm font-medium text-slate-700">Remove {passenger.firstName}?</span>
            <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={remove.isPending}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onEdit} aria-label={`Edit ${name}`}>
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Remove ${name}`}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              Remove
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
