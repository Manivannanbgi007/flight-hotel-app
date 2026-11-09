import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { HotelPhotosPage } from './HotelPhotosPage';
import { managerApi } from './managerApi';
import type { HotelProfile, ImageItem, RoomTypeItem } from './types';

vi.mock('./managerApi', () => ({
  managerApi: { profile: vi.fn(), roomTypes: vi.fn(), uploadImage: vi.fn(), updateImage: vi.fn(), deleteImage: vi.fn() },
}));

const manager: AuthUser = { ...customer, id: 'm1', roles: ['HOTEL_MANAGER'] };

const image = (overrides: Partial<ImageItem> = {}): ImageItem => ({
  id: 'img1', url: '/api/hotels/images/img1', thumbUrl: '/api/hotels/images/img1?size=thumb', caption: 'Beach view', cover: true,
  sortOrder: 0, roomTypeId: null, width: 1600, height: 1067, ...overrides,
});

const images = [
  image(),
  image({ id: 'img2', caption: 'Pool', cover: false, sortOrder: 1 }),
  image({ id: 'img3', caption: 'Deluxe room', cover: false, sortOrder: 2, roomTypeId: 'rt1' }),
];

const profileWith = (photos: ImageItem[]) => ({ id: 'h1', images: photos }) as HotelProfile;
const roomType = { id: 'rt1', name: 'Deluxe Sea View' } as RoomTypeItem;

const open = () => renderRoutes([{ path: '/hotel-manager/hotels/:hotelId/photos', element: <HotelPhotosPage /> }],
  { path: '/hotel-manager/hotels/h1/photos', auth: fakeAuth({ user: manager }) });

const jpeg = (name: string, bytes = 1024) => new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });

/** The card of a photo, found by its delete button (named after the caption). */
const cardOf = async (caption: string) =>
  (await screen.findByRole('button', { name: `Delete photo ${caption}` })).closest('li') as HTMLElement;

beforeEach(() => {
  vi.mocked(managerApi.profile).mockResolvedValue(profileWith(images));
  vi.mocked(managerApi.roomTypes).mockResolvedValue([roomType]);
});

describe('HotelPhotosPage', () => {
  it('shows the photos with the cover and room labels; only other hotel photos can become the cover', async () => {
    open();

    const cover = await cardOf('Beach view');
    expect(within(cover).getByText('Cover')).toBeInTheDocument();
    expect(within(cover).queryByRole('button', { name: /Make cover/ })).not.toBeInTheDocument();

    const pool = await cardOf('Pool');
    expect(within(pool).queryByText('Cover')).not.toBeInTheDocument();
    expect(within(pool).getByRole('button', { name: /Make cover/ })).toBeInTheDocument();

    const room = await cardOf('Deluxe room');
    expect(await within(room).findByText('Deluxe Sea View')).toBeInTheDocument();
    expect(within(room).queryByRole('button', { name: /Make cover/ })).not.toBeInTheDocument();
  });

  it('filters the gallery to the hotel photos or the room photos', async () => {
    const { user } = open();

    const show = await screen.findByRole('list', { name: 'Show' });
    expect(within(show).getByRole('button', { name: /^All\s*3$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(show).getByRole('button', { name: /^Hotel\s*2$/ })).toBeInTheDocument();
    await user.click(within(show).getByRole('button', { name: /^Rooms\s*1$/ }));

    expect(within(show).getByRole('button', { name: /^Rooms/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await cardOf('Deluxe room')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete photo Beach view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete photo Pool' })).not.toBeInTheDocument();

    await user.click(within(show).getByRole('button', { name: /^Hotel/ }));
    expect(await cardOf('Beach view')).toBeInTheDocument();
    expect(await cardOf('Pool')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete photo Deluxe room' })).not.toBeInTheDocument();
  });

  it('says so when a filter has no photos', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profileWith([image()]));
    const { user } = open();

    await user.click(within(await screen.findByRole('list', { name: 'Show' })).getByRole('button', { name: /^Rooms/ }));

    expect(screen.getByText(/No room photos yet/)).toBeInTheDocument();
  });

  it('explains that a hotel needs a cover photo when there are none', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profileWith([]));
    open();

    expect(await screen.findByRole('heading', { name: 'No photos yet' })).toBeInTheDocument();
    expect(screen.getByText('Hotels need a cover photo before they can be published.')).toBeInTheDocument();
  });

  it('uploads several photos of a room type', async () => {
    vi.mocked(managerApi.uploadImage).mockImplementation(async (_hotel, file) => image({ id: file.name }));
    const { user } = open();

    await user.selectOptions(await screen.findByRole('combobox', { name: /Photo of/ }), 'Room: Deluxe Sea View');
    const files = [jpeg('one.jpg'), jpeg('two.jpg')];
    await user.upload(screen.getByLabelText('Choose photos'), files);

    expect(await screen.findByText('2 photos uploaded.')).toBeInTheDocument();
    expect(managerApi.uploadImage).toHaveBeenCalledWith('h1', files[0], undefined, 'rt1', expect.any(Function));
    expect(managerApi.uploadImage).toHaveBeenCalledWith('h1', files[1], undefined, 'rt1', expect.any(Function));
    // The list is reloaded to show the new photos.
    await waitFor(() => expect(managerApi.profile).toHaveBeenCalledTimes(2));
  });

  it('skips photos over 5 MB and uploads the rest as hotel photos', async () => {
    vi.mocked(managerApi.uploadImage).mockResolvedValue(image({ id: 'img9' }));
    const { user } = open();

    const small = jpeg('small.jpg');
    await user.upload(await screen.findByLabelText('Choose photos'), [jpeg('huge.jpg', 5 * 1024 * 1024 + 1), small]);

    expect(await screen.findByText('huge.jpg: larger than 5 MB.')).toBeInTheDocument();
    expect(await screen.findByText('1 photo uploaded.')).toBeInTheDocument();
    expect(managerApi.uploadImage).toHaveBeenCalledTimes(1);
    expect(managerApi.uploadImage).toHaveBeenCalledWith('h1', small, undefined, undefined, expect.any(Function));
  });

  it('does not upload when every photo is too large', async () => {
    const { user } = open();

    await user.upload(await screen.findByLabelText('Choose photos'), [jpeg('huge.jpg', 5 * 1024 * 1024 + 1)]);

    expect(await screen.findByText('huge.jpg: larger than 5 MB.')).toBeInTheDocument();
    expect(managerApi.uploadImage).not.toHaveBeenCalled();
  });

  it('explains a failed upload', async () => {
    vi.mocked(managerApi.uploadImage).mockRejectedValue(new ApiError(415, 'UNSUPPORTED_IMAGE', 'Only JPEG and PNG images are accepted.'));
    const { user } = open();

    await user.upload(await screen.findByLabelText('Choose photos'), [jpeg('one.jpg')]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Only JPEG and PNG images are accepted.');
  });

  it('edits a caption, makes a photo the cover and deletes a photo', async () => {
    vi.mocked(managerApi.updateImage).mockResolvedValue(image({ id: 'img2' }));
    vi.mocked(managerApi.deleteImage).mockResolvedValue(undefined);
    const { user } = open();

    const pool = await cardOf('Pool');
    const caption = within(pool).getByRole('textbox', { name: 'Caption' });
    expect(within(pool).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await user.clear(caption);
    await user.type(caption, 'Pool at night');
    await user.click(within(pool).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(managerApi.updateImage).toHaveBeenCalledWith('h1', 'img2', { caption: 'Pool at night' }));

    await user.click(within(pool).getByRole('button', { name: /Make cover/ }));
    await waitFor(() => expect(managerApi.updateImage).toHaveBeenCalledWith('h1', 'img2', { cover: true }));

    // Deleting asks first: keeping the photo deletes nothing.
    await user.click(screen.getByRole('button', { name: 'Delete photo Deluxe room' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this photo?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(managerApi.deleteImage).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete photo Deluxe room' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete this photo?' })).getByRole('button', { name: 'Delete photo' }));
    await waitFor(() => expect(managerApi.deleteImage).toHaveBeenCalledWith('h1', 'img3'));
  });

  it('counts the photos and says whether a cover photo is set', async () => {
    open();

    const figures = await screen.findByRole('list', { name: 'Photo figures' });
    const card = (label: string) => within(figures).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    await waitFor(() => expect(card('Photos')).toHaveTextContent('3'));
    expect(card('Hotel photos')).toHaveTextContent('2');
    expect(card('Room photos')).toHaveTextContent('1');
    expect(card('Cover photo')).toHaveTextContent('Set');
  });

  it('refuses a file that is not a JPEG or PNG without uploading it', async () => {
    open();

    // fireEvent: the file chooser's accept filter would already hide the PDF from user.upload.
    fireEvent.change(await screen.findByLabelText('Choose photos'), {
      target: { files: [new File(['x'], 'plan.pdf', { type: 'application/pdf' })] },
    });

    expect(await screen.findByText('plan.pdf: only JPEG and PNG photos are accepted.')).toBeInTheDocument();
    expect(managerApi.uploadImage).not.toHaveBeenCalled();
  });
});
