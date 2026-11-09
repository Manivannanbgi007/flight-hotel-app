import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AuthContext, type AuthContextValue } from '@/app/providers/authContext';
import { apiClient } from '@/lib/api/client';
import type { AuthUser } from '@/lib/auth/types';
import { admin, customer, fakeAuth } from '@/test/renderRoutes';
import { AssistantLauncher } from './AssistantLauncher';
import { readConversationId, writeConversationId } from './conversationStorage';
import type { AssistantPanelProps } from './AssistantPanel';

vi.mock('@/lib/api/client', () => ({ apiClient: { get: vi.fn() }, refreshAccessToken: vi.fn() }));

// The real panel has its own tests; here only what the launcher hands it.
vi.mock('./AssistantPanel', () => ({
  default: ({ open, onClose, user, size, onSizeChange }: AssistantPanelProps) => (
    <div role="dialog" aria-label="AI assistant" hidden={!open} data-size={size}>
      <p>panel for {user.firstName}</p>
      <button type="button" onClick={onClose}>Minimize the assistant</button>
      <button type="button" onClick={() => onSizeChange(size === 'maximized' ? 'normal' : 'maximized')}>Toggle size</button>
    </div>
  ),
}));

const CONFIG = {
  enabled: true,
  model: 'granite4:tiny-h',
  voice: { transcription: false, speech: false },
  limits: { maxMessageLength: 2000, maxAudioBytes: 5242880, maxAudioSeconds: 60, maxSpeechChars: 1000 },
};
const CONVERSATION_ID = '01a1afe8-274d-7009-b220-93959948511e';

function renderLauncher({ user = customer as AuthUser | null, path = '/my-trips', config = CONFIG as unknown } = {}) {
  vi.mocked(apiClient.get).mockResolvedValue({ data: config });
  const router = createMemoryRouter([{ path: '*', element: <AssistantLauncher /> }], { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (auth: AuthContextValue) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(fakeAuth({ user })));
  /** Another account signs in, or (null) the user signs out. */
  const setAuth = (auth: AuthContextValue) => view.rerender(tree(auth));
  return { router, user: userEvent.setup(), setAuth };
}

describe('AssistantLauncher', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('shows the launcher to a signed-in user when the assistant is enabled', async () => {
    renderLauncher();

    expect(await screen.findByRole('button', { name: 'Open the assistant' })).toBeVisible();
    expect(apiClient.get).toHaveBeenCalledWith('/assistant/config');
  });

  it('shows nothing to a visitor and does not ask for the config', async () => {
    renderLauncher({ user: null });

    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: /assistant/i })).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('shows nothing while the assistant is disabled (model down or not loaded)', async () => {
    renderLauncher({ config: { ...CONFIG, enabled: false } });

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: /assistant/i })).not.toBeInTheDocument();
  });

  it('shows nothing when the config cannot be read', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('down'));
    const router = createMemoryRouter([{ path: '*', element: <AssistantLauncher /> }], { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthContext.Provider value={fakeAuth({ user: customer })}><RouterProvider router={router} /></AuthContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: /assistant/i })).not.toBeInTheDocument();
  });

  it('takes the accent of the staff portal it is shown in', async () => {
    renderLauncher({ user: admin, path: '/admin/bookings' });

    const launcher = await screen.findByRole('button', { name: 'Open the assistant' });
    expect(launcher.closest('[data-assistant-root]')).toHaveClass('role-admin');
  });

  it('opens the panel, closes it again and gives the focus back to the launcher', async () => {
    const { user } = renderLauncher();
    const launcher = await screen.findByRole('button', { name: 'Open the assistant' });

    await user.click(launcher);
    const panel = await screen.findByRole('dialog', { name: 'AI assistant' });
    expect(panel).toBeVisible();
    expect(launcher).toHaveAttribute('aria-expanded', 'true');
    expect(launcher).toHaveAttribute('aria-controls', 'assistant-panel');
    expect(launcher).toHaveAccessibleName('Minimize the assistant');

    await user.click(within(panel).getByRole('button', { name: 'Minimize the assistant' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(launcher).toHaveFocus();
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    expect(launcher).toHaveAccessibleName('Open the assistant');
  });

  it('maximizes: hides the launcher, dims the page (a click there minimizes) and remembers the size', async () => {
    const { user } = renderLauncher();
    const launcher = await screen.findByRole('button', { name: 'Open the assistant' });
    await user.click(launcher);
    const panel = await screen.findByRole('dialog', { name: 'AI assistant' });
    expect(panel).toHaveAttribute('data-size', 'normal');

    await user.click(within(panel).getByRole('button', { name: 'Toggle size' }));
    expect(panel).toHaveAttribute('data-size', 'maximized');
    expect(launcher).toHaveClass('hidden');
    expect(window.localStorage.getItem('fh.assistant.maximized')).toBe('true');

    const backdrop = document.querySelector('[data-assistant-root] > div[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(launcher).not.toHaveClass('hidden');
    expect(launcher).toHaveFocus();

    // Opened again: still maximized.
    await user.click(launcher);
    expect(await screen.findByRole('dialog', { name: 'AI assistant' })).toHaveAttribute('data-size', 'maximized');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Toggle size' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'normal');
    expect(launcher).not.toHaveClass('hidden');
  });

  it('forgets the conversation and drops the panel when the user signs out or another account signs in', async () => {
    writeConversationId(customer.id, CONVERSATION_ID);
    const { user, setAuth } = renderLauncher();
    await user.click(await screen.findByRole('button', { name: 'Open the assistant' }));
    expect(await screen.findByText('panel for Asha')).toBeInTheDocument();

    act(() => setAuth(fakeAuth({ user: { ...admin, firstName: 'Ravi' } })));

    await waitFor(() => expect(screen.queryByText('panel for Asha')).not.toBeInTheDocument());
    expect(readConversationId(customer.id)).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => setAuth(fakeAuth({ user: null })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /assistant/i })).not.toBeInTheDocument());
  });
});
