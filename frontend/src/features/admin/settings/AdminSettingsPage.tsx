import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Settings } from 'lucide-react';

import { useRealtimeEvent } from '@/app/providers/useRealtime';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime } from '@/lib/format';
import { LoadError, PageHeader, ProblemAlert } from '../shared/adminUi';
import { useCan } from '../shared/permissions';
import { groupSettings, settingsApi, settingValueProblem, type SystemSetting } from './settingsApi';

/**
 * /admin/settings — system settings, grouped. A change is saved with the version that was on screen; when someone else
 * changed the setting meanwhile (live update or `409`), the new value is shown before anything is overwritten.
 */
export function AdminSettingsPage() {
  const canEdit = useCan('SETTINGS_MANAGE');
  const settings = useQuery({ queryKey: queryKeys.admin.settings, queryFn: settingsApi.list });
  const [changedLive, setChangedLive] = useState<string | null>(null);
  // Versions this admin saved: their own change comes back as a live message too and is not "someone else".
  const savedHere = useRef(new Map<string, number>());
  // The list itself refreshes through the invalidation rules; this only tells the admin what changed.
  useRealtimeEvent('settings.changed', (message) => {
    const key = message.resourceId;
    if (key && savedHere.current.get(key) !== message.data.version) {
      setChangedLive(key);
    }
  });
  const onSaved = (saved: SystemSetting) => savedHere.current.set(saved.key, saved.version);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<Settings className="size-5" />}
        title="System settings"
        description="Changes reach every service within seconds. Public settings are shown to customers (site name, support contacts)."
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />
      {!canEdit && <Alert tone="info">You can see the settings but not change them.</Alert>}
      {changedLive && (
        <Alert tone="info">
          <span className="font-mono">{changedLive}</span> was just changed by another admin. The list shows the new value.
        </Alert>
      )}
      {settings.isPending && <Skeleton className="h-96 w-full" />}
      {settings.isError && <LoadError error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.data?.length === 0 && <EmptyState title="No settings" />}
      {settings.data && groupSettings(settings.data).map(({ group, settings: list }) => (
        <section key={group} aria-label={group} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase text-slate-500">{group}</h2>
          <Card className="divide-y divide-slate-100">
            {list.map((setting) => <SettingRow key={setting.key} setting={setting} canEdit={canEdit} onSaved={onSaved} />)}
          </Card>
        </section>
      ))}
    </div>
  );
}

function shownValue(setting: Pick<SystemSetting, 'value' | 'valueType'>): string {
  if (setting.value === null || setting.value === '') return '(empty)';
  if (setting.valueType === 'BOOLEAN') return setting.value === 'true' ? 'On' : 'Off';
  return setting.value;
}

function SettingRow({ setting, canEdit, onSaved }: { setting: SystemSetting; canEdit: boolean; onSaved: (saved: SystemSetting) => void }) {
  const [editing, setEditing] = useState(false);
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={labelId} className="flex flex-wrap items-center gap-2 font-mono text-sm font-semibold text-slate-900">
            {setting.key}
            {setting.publicSetting && <Badge tone="info" className="font-sans">Public</Badge>}
          </p>
          {setting.description && <p className="text-sm text-slate-600">{setting.description}</p>}
          {!editing && <p className="mt-1 break-words text-sm text-slate-900">{shownValue(setting)}</p>}
          <p className="text-xs text-slate-500">
            {setting.updatedAt ? `Changed ${formatDateTime(setting.updatedAt)}` : ''}{setting.updatedBy ? ` by ${setting.updatedBy}` : ''} · version {setting.version}
          </p>
        </div>
        {canEdit && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)} aria-label={`Change ${setting.key}`}>Change</Button>
        )}
      </div>
      {editing && <SettingEditor setting={setting} onSaved={onSaved} onClose={() => setEditing(false)} />}
    </div>
  );
}

function SettingEditor({ setting, onSaved, onClose }: { setting: SystemSetting; onSaved: (saved: SystemSetting) => void; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(setting.value ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  // The version the admin started from: a newer one on screen means someone else saved meanwhile.
  const [baseVersion] = useState(setting.version);
  const changedMeanwhile = setting.version !== baseVersion;

  const save = useMutation({
    mutationFn: () => settingsApi.update(setting.key, draft.trim(), setting.version),
    onSuccess: (saved) => {
      onSaved(saved);
      queryClient.setQueryData<SystemSetting[]>(queryKeys.admin.settings, (old) => old?.map((item) => (item.key === saved.key ? saved : item)));
      void queryClient.invalidateQueries({ queryKey: queryKeys.publicSettings });
      toast.success(`${saved.key} saved.`);
      onClose();
    },
    onError: (error) => {
      if (ApiError.from(error).code === 'SETTING_CHANGED_BY_SOMEONE_ELSE') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings });
      }
    },
  });
  const conflict = save.error && ApiError.from(save.error).code === 'SETTING_CHANGED_BY_SOMEONE_ELSE';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const invalid = settingValueProblem(setting.valueType, draft);
    setProblem(invalid);
    if (!invalid) save.mutate();
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3">
      {(changedMeanwhile || conflict) && (
        <Alert tone="warning" title="Someone else changed this setting">
          {changedMeanwhile
            ? <>The value is now <strong className="break-words">{shownValue(setting)}</strong>. Saving replaces it with yours.</>
            : 'Loading the latest value…'}
        </Alert>
      )}
      {setting.valueType === 'BOOLEAN' ? (
        <SelectField label="New value" value={draft} onChange={(event) => setDraft(event.target.value)} error={problem ?? undefined}>
          <option value="true">On</option>
          <option value="false">Off</option>
        </SelectField>
      ) : (
        <TextField
          label="New value"
          value={draft}
          inputMode={setting.valueType === 'INTEGER' ? 'numeric' : setting.valueType === 'DECIMAL' ? 'decimal' : undefined}
          hint={setting.valueType === 'DURATION' ? 'ISO-8601 duration, for example PT15M or P1D.' : undefined}
          error={problem ?? undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {save.isError && !conflict && <ProblemAlert error={save.error} title="Not saved" />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
