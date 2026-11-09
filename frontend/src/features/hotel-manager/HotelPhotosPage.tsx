import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { BedDouble, CloudUpload, Image as ImageIcon, Images, Star, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { formatCount } from '@/components/charts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { controlClass, selectClass } from '@/components/ui/fieldStyles';
import { EmptyState, LoadingState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { FilterPills, ManagerPageHeader, MetricGrid, MetricTile } from './ManagerParts';
import { managerApi } from './managerApi';
import type { ImageItem } from './types';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png'];

type Show = 'all' | 'hotel' | 'rooms';

/**
 * /hotel-manager/hotels/:hotelId/photos — the hotel's and its rooms' photos: figures, a drop zone (drag and drop or the
 * file chooser, for the hotel or one room type, with a progress bar per file) and the gallery, filtered by hotel or room
 * photos, where each photo gets a caption, can become the cover (hotel photos) or be deleted.
 */
export function HotelPhotosPage() {
  const { hotelId = '' } = useParams();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [roomTypeId, setRoomTypeId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [show, setShow] = useState<Show>('all');
  /** Share of the current upload that was sent, per file name (a progress bar each). */
  const [progress, setProgress] = useState<Record<string, number>>({});
  const profile = useQuery({ queryKey: queryKeys.hotelManager.profile(hotelId), queryFn: () => managerApi.profile(hotelId) });
  const roomTypes = useQuery({ queryKey: queryKeys.hotelManager.roomTypes(hotelId), queryFn: () => managerApi.roomTypes(hotelId) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.hotelManager.profile(hotelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.hotelManager.hotels });
  };
  const upload = useMutation({
    mutationFn: (files: File[]) => Promise.all(files.map((file) => managerApi.uploadImage(hotelId, file, undefined, roomTypeId || undefined,
      (percent) => setProgress((current) => ({ ...current, [file.name]: percent }))))),
    onSuccess: (uploaded) => {
      refresh();
      toast.success(`${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} uploaded.`);
    },
    onError: refresh,
    onSettled: () => setProgress({}),
  });

  /** Checks the type and size in the browser (the server checks again) and uploads what is fine. */
  const addFiles = (chosen: File[]) => {
    const wrongType = chosen.filter((f) => f.type !== '' && !ACCEPTED.includes(f.type));
    if (wrongType.length) {
      toast.error(`${wrongType.map((f) => f.name).join(', ')}: only JPEG and PNG photos are accepted.`);
    }
    const typed = chosen.filter((f) => !wrongType.includes(f));
    const tooBig = typed.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) {
      toast.error(`${tooBig.map((f) => f.name).join(', ')}: larger than 5 MB.`);
    }
    const ok = typed.filter((f) => f.size <= MAX_BYTES);
    if (ok.length) upload.mutate(ok);
  };
  const onFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    addFiles(files);
  };

  if (profile.isPending) return <LoadingState label="Loading the photos…" />;
  const images = profile.data?.images ?? [];
  const roomNames = new Map((roomTypes.data ?? []).map((r) => [r.id, r.name]));
  const cover = images.find((image) => image.cover);
  const roomPhotos = images.filter((image) => image.roomTypeId).length;
  const hotelPhotos = images.length - roomPhotos;
  const uploading = Object.entries(progress);
  const shown = images.filter((image) => show === 'all' || (show === 'rooms') === Boolean(image.roomTypeId));

  return (
    <div className="flex flex-col gap-5">
      <ManagerPageHeader
        icon={<ImageIcon className="size-5" />}
        title="Photos"
        description="Guests see these on the hotel page and with each room type. The cover photo is shown in search results."
      />

      <MetricGrid label="Photo figures">
        <MetricTile label="Photos" value={images.length} format={formatCount} icon={<Images className="size-5" />} hint="Of the hotel and its rooms" />
        <MetricTile label="Hotel photos" value={hotelPhotos} format={formatCount} icon={<ImageIcon className="size-5" />} hint="Shown on the hotel's page" />
        <MetricTile label="Room photos" value={roomPhotos} format={formatCount} icon={<BedDouble className="size-5" />} hint="Shown with their room type" />
        <MetricTile label="Cover photo" icon={<Star className="size-5" />}
          value={cover ? 'Set' : <span className="text-danger-600">Missing</span>}
          hint={cover ? (cover.caption ?? 'Shown in search results') : 'Needed before the hotel can be published'} />
      </MetricGrid>

      <section
        aria-label="Add photos"
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => {
          // Moving over the zone's own children fires dragleave too: only leaving the zone ends the highlight.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}
        className={cn(
          'flex flex-col items-center gap-5 rounded-3xl border-2 border-dashed px-5 py-8 text-center transition-colors duration-(--duration-fast) sm:px-8',
          dragging ? 'border-role-500 bg-role-50' : 'border-slate-300 bg-white/70 hover:border-role-300',
        )}
      >
        <span aria-hidden="true"
          className={cn('flex size-14 items-center justify-center rounded-2xl ring-1 ring-inset transition-transform duration-(--duration-base)',
            dragging ? 'scale-110 bg-role-600 text-white ring-role-600' : 'bg-role-50 text-role-600 ring-role-100')}>
          <CloudUpload className="size-7" />
        </span>
        <div>
          <p className="text-base font-semibold text-slate-900">{dragging ? 'Drop the photos to upload them' : 'Drag photos here or choose files'}</p>
          <p className="mt-1 text-sm text-slate-500">JPEG or PNG, up to 5 MB each. Photos are resized and location data is removed.</p>
        </div>
        <div className="flex flex-wrap items-end justify-center gap-2">
          <label className="flex flex-col items-start gap-1.5 text-left text-sm font-semibold text-slate-800">
            Photo of
            <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className={cn(selectClass(false, { inline: true }), 'min-w-56')}>
              <option value="">The hotel</option>
              {(roomTypes.data ?? []).map((r) => <option key={r.id} value={r.id}>Room: {r.name}</option>)}
            </select>
          </label>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple className="sr-only" aria-label="Choose photos" onChange={onFiles} />
          <Button variant="role" loading={upload.isPending} onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" aria-hidden="true" /> Upload photos
          </Button>
        </div>
        {uploading.length > 0 && (
          <ul aria-label="Uploads" className="flex w-full max-w-xl flex-col gap-2 text-left">
            {uploading.map(([name, percent]) => (
              <li key={name} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 shadow-xs ring-1 ring-slate-200">
                <ImageIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <progress value={percent} max={100} aria-label={`Uploading ${name}`} className="h-2 w-32 overflow-hidden rounded-full accent-role-600 sm:w-40" />
                <span className="w-10 text-right tabular-nums">{percent}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {upload.isError && <Alert tone="danger">{ApiError.from(upload.error).message}</Alert>}

      {images.length === 0 ? (
        <EmptyState title="No photos yet" description="Hotels need a cover photo before they can be published." />
      ) : (
        <section aria-labelledby="gallery-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="gallery-title" className="text-base font-semibold text-slate-900">Gallery</h3>
            <FilterPills<Show> label="Show" value={show} onChange={setShow} options={[
              { value: 'all', label: 'All', count: images.length },
              { value: 'hotel', label: 'Hotel', count: hotelPhotos },
              { value: 'rooms', label: 'Rooms', count: roomPhotos },
            ]} />
          </div>
          {shown.length === 0 ? (
            <p className="rounded-2xl border border-slate-200/80 bg-white px-4 py-6 text-center text-sm text-slate-600 shadow-card">
              {show === 'rooms'
                ? 'No room photos yet. Choose a room type under "Photo of" and upload its photos.'
                : 'No hotel photos yet. Upload photos of the building, the lobby and the facilities.'}
            </p>
          ) : (
            <ul aria-label="Photos" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((image) => (
                <li key={image.id} className="min-w-0">
                  <PhotoCard hotelId={hotelId} image={image} roomName={image.roomTypeId ? roomNames.get(image.roomTypeId) : undefined} onChanged={refresh} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function PhotoCard({ hotelId, image, roomName, onChanged }: {
  hotelId: string;
  image: ImageItem;
  roomName?: string;
  onChanged: () => void;
}) {
  const [caption, setCaption] = useState(image.caption ?? '');
  const update = useMutation({
    mutationFn: (body: { caption?: string; cover?: boolean }) => managerApi.updateImage(hotelId, image.id, body),
    onSuccess: onChanged,
  });
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => managerApi.deleteImage(hotelId, image.id),
    onSuccess: () => { setConfirming(false); onChanged(); },
  });
  const changed = caption !== (image.caption ?? '');

  return (
    <article className={cn(
      'group flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-card transition-shadow duration-(--duration-base) hover:shadow-lg',
      image.cover ? 'border-role-300 ring-2 ring-role-200' : 'border-slate-200/80',
    )}>
      <div className="relative aspect-[3/2] overflow-hidden bg-slate-100">
        <img src={image.thumbUrl} alt={image.caption ?? ''} loading="lazy"
          className="size-full object-cover transition-transform duration-(--duration-slower) ease-out-soft group-hover:scale-105" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-slate-950/35 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {image.cover && (
            <span className="inline-flex items-center gap-1 rounded-full bg-role-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
              <Star className="size-3.5 fill-current" aria-hidden="true" />Cover
            </span>
          )}
          {roomName && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm">
              <BedDouble className="size-3.5" aria-hidden="true" />{roomName}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <form className="flex min-w-0 items-center gap-2 [&>input]:min-w-0" onSubmit={(e) => { e.preventDefault(); update.mutate({ caption }); }}>
          <input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption"
            aria-label="Caption" className={controlClass(false)} />
          {changed && <Button type="submit" size="sm" variant="role" loading={update.isPending}>Save</Button>}
        </form>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          {!image.cover && !image.roomTypeId ? (
            <Button size="sm" variant="ghost" loading={update.isPending && update.variables?.cover === true} onClick={() => update.mutate({ cover: true })}>
              <Star className="size-4" aria-hidden="true" /> Make cover
            </Button>
          ) : (
            <span className="px-1 text-xs text-slate-500">
              {image.cover ? 'Shown in search results' : `Shown with ${roomName ?? 'its room type'}`}
            </span>
          )}
          <Button size="sm" variant="ghost" aria-label={`Delete photo ${image.caption ?? ''}`} onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </Button>
        </div>
      </div>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Delete this photo?"
        description={image.cover ? 'This is the cover photo: the hotel needs a new one before it can be published.' : 'Guests will no longer see it.'}>
        <div className="flex flex-col gap-4">
          <img src={image.thumbUrl} alt="" className="aspect-[3/2] w-full rounded-xl object-cover" />
          {remove.isError && <Alert tone="danger">{ApiError.from(remove.error).message}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete photo</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button>
          </div>
        </div>
      </Dialog>
    </article>
  );
}
