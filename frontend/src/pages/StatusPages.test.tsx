import { screen, within } from '@testing-library/react';

import { renderRoutes } from '@/test/renderRoutes';
import { RouteErrorPage } from './RouteErrorPage';
import { UnderConstructionPage } from './UnderConstructionPage';

function Broken(): never {
  throw new Error('render failed');
}

/** Like app/router.tsx: the layout route catches errors of every page below it. */
const open = (path: string) => renderRoutes([{
  path: '/',
  errorElement: <RouteErrorPage />,
  children: [
    { index: true, element: <p>home page</p> },
    { path: 'broken', element: <Broken /> },
  ],
}], { path });

describe('RouteErrorPage', () => {
  it('shows "page not found" for an unknown address', () => {
    open('/no-such-page');

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/customer/home');
  });

  it('replaces a page that failed to render with an error message, not a blank screen', () => {
    // React reports the render error on the console; that is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open('/broken');

    const error = screen.getByRole('alert');
    expect(within(error).getByRole('heading', { name: 'This page could not be displayed' })).toBeInTheDocument();
    expect(error).toHaveTextContent('Please reload the page. If the problem continues, contact support.');
    expect(within(error).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('render failed')).not.toBeInTheDocument();
  });
});

describe('UnderConstructionPage', () => {
  it('says honestly which phase brings the section, and links home', () => {
    renderRoutes(<UnderConstructionPage title="Loyalty points" phase="Phase 12" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Loyalty points' })).toBeInTheDocument();
    expect(screen.getByText('This section is being built and will be available in Phase 12.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/customer/home');
  });
});
