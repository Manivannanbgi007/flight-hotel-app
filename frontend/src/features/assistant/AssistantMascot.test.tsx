import { render } from '@testing-library/react';

import { AssistantMascot } from './AssistantMascot';

describe('AssistantMascot', () => {
  it('is a decorative, animated drawing: hidden from screen readers, with its own ids per instance', () => {
    const { container } = render(<><AssistantMascot /><AssistantMascot busy className="size-9" /></>);
    const [calm, busy] = Array.from(container.querySelectorAll('svg'));

    expect(calm).toHaveAttribute('aria-hidden', 'true');
    expect(calm).toHaveAttribute('focusable', 'false');
    expect(calm?.querySelector('.mascot-eye')).not.toBeNull();
    expect(calm?.querySelector('.mascot-bob')).not.toBeNull();
    expect(calm).not.toHaveClass('mascot--busy');
    expect(busy).toHaveClass('mascot--busy', 'size-9');
    // Two drawings on one page do not share gradient ids.
    const ids = (svg: Element | undefined) => Array.from(svg?.querySelectorAll('[id]') ?? []).map((node) => node.id);
    expect(ids(calm).filter((id) => ids(busy).includes(id))).toEqual([]);
  });
});
