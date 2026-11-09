import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Pagination, type PageInfo } from './Pagination';
import { PAGE_SIZES_UP_TO_50, pageItems, rangeOf, readPageSize, type PageItem } from './paginationItems';

/** Zero-based items as the one-based labels a person sees. */
const shown = (items: PageItem[]) => items.map((item) => (typeof item === 'number' ? String(item + 1) : '…')).join(' ');

describe('pageItems', () => {
  it('lists every page when they fit', () => {
    expect(shown(pageItems(0, 1))).toBe('1');
    expect(shown(pageItems(3, 7))).toBe('1 2 3 4 5 6 7');
    expect(pageItems(0, 0)).toEqual([]);
  });

  it('keeps the first, the last and the neighbours of the current page, with gaps, in a constant number of slots', () => {
    expect(shown(pageItems(0, 10))).toBe('1 2 3 4 5 … 10');
    expect(shown(pageItems(3, 10))).toBe('1 2 3 4 5 … 10');
    expect(shown(pageItems(4, 10))).toBe('1 … 4 5 6 … 10');
    expect(shown(pageItems(5, 10))).toBe('1 … 5 6 7 … 10');
    expect(shown(pageItems(9, 10))).toBe('1 … 6 7 8 9 10');
    expect(shown(pageItems(46, 47))).toBe('1 … 43 44 45 46 47');
    for (let page = 0; page < 47; page += 1) expect(pageItems(page, 47)).toHaveLength(7);
  });

  it('shows fewer neighbours on phones', () => {
    expect(shown(pageItems(0, 47, 0))).toBe('1 2 3 … 47');
    expect(shown(pageItems(4, 47, 0))).toBe('1 … 5 … 47');
    expect(shown(pageItems(46, 47, 0))).toBe('1 … 45 46 47');
  });

  it('keeps an out-of-range page inside the list', () => {
    expect(shown(pageItems(99, 10))).toBe('1 … 6 7 8 9 10');
  });
});

describe('rangeOf and readPageSize', () => {
  it('gives the rows of a page', () => {
    expect(rangeOf(0, 25, 927)).toEqual({ from: 1, to: 25 });
    expect(rangeOf(37, 25, 927)).toEqual({ from: 926, to: 927 });
    expect(rangeOf(0, 25, 0)).toEqual({ from: 0, to: 0 });
  });

  it('takes ?size= only when the table offers it', () => {
    expect(readPageSize(new URLSearchParams('size=50'), PAGE_SIZES_UP_TO_50, 10)).toBe(50);
    expect(readPageSize(new URLSearchParams('size=100'), PAGE_SIZES_UP_TO_50, 10)).toBe(10);
    expect(readPageSize(new URLSearchParams('size=abc'), PAGE_SIZES_UP_TO_50, 10)).toBe(10);
    expect(readPageSize(new URLSearchParams(''), PAGE_SIZES_UP_TO_50, 25)).toBe(25);
  });
});

/** The "Showing … of …" line. */
const summary = () => screen.getByText((_, element) => element?.tagName === 'P' && /^Showing/.test(element.textContent ?? ''));

const page = (overrides: Partial<PageInfo> = {}): PageInfo => ({ page: 1, size: 25, totalElements: 927, totalPages: 38, ...overrides });

/** A desktop-wide screen (jsdom has no matchMedia: without it the phone layout is used). */
function stubWideScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('Pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the rows, the total and the page, marks the current page and pages with the buttons', async () => {
    stubWideScreen();
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination data={page()} onPageChange={onPageChange} noun={['booking', 'bookings']} />);

    expect(summary()).toHaveTextContent('Showing 26–50 of 927 bookings·Page 2 of 38');
    expect(screen.getByText('Page 2 of 38')).toHaveAttribute('aria-live', 'polite');
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getAllByRole('button', { name: /^Page \d+$/ }).map((button) => button.textContent)).toEqual(['1', '2', '3', '4', '5', '38']);

    await user.click(within(nav).getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    await user.click(within(nav).getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenLastCalledWith(0);
    await user.click(within(nav).getByRole('button', { name: 'Page 38' }));
    expect(onPageChange).toHaveBeenLastCalledWith(37);
    // The current page is not "changed" to itself.
    onPageChange.mockClear();
    await user.click(within(nav).getByRole('button', { name: 'Page 2' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('shows fewer page numbers on a phone', () => {
    render(<Pagination data={page({ page: 9 })} onPageChange={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^Page \d+$/ }).map((button) => button.textContent)).toEqual(['1', '10', '38']);
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(<Pagination data={page({ page: 0 })} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    rerender(<Pagination data={page({ page: 37 })} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(summary()).toHaveTextContent('Showing 926–927 of 927 results');
  });

  it('offers the page sizes the list allows, with the one in use selected', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(<Pagination data={page()} onPageChange={vi.fn()} onPageSizeChange={onPageSizeChange} pageSizes={PAGE_SIZES_UP_TO_50} />);

    const sizes = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(sizes).toHaveValue('25');
    expect(within(sizes).getAllByRole('option').map((option) => option.textContent)).toEqual(['10', '25', '50']);
    await user.selectOptions(sizes, '50');
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('keeps a size the server chose that is not in the menu (e.g. a capped size)', () => {
    render(<Pagination data={page({ size: 20 })} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />);
    expect(within(screen.getByRole('combobox', { name: 'Rows per page' })).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['10', '20', '25', '50', '100']);
  });

  it('shows nothing for an empty list or a single page without a size menu, and only the summary and menu for one page', () => {
    const { container, rerender } = render(<Pagination data={page({ totalElements: 0, totalPages: 0 })} onPageChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<Pagination data={page({ page: 0, totalElements: 7, totalPages: 1 })} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<Pagination data={page({ page: 0, size: 50, totalElements: 40, totalPages: 1 })} onPageChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<Pagination data={page({ page: 0, size: 50, totalElements: 40, totalPages: 1 })} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />);
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('50');
    expect(summary()).toHaveTextContent('Showing 1–40 of 40 results');
  });

  it('marks itself for the assistant button to keep clear', () => {
    const { container } = render(<Pagination data={page()} onPageChange={vi.fn()} />);
    expect(container.firstElementChild).toHaveAttribute('data-assistant-avoid');
  });
});
