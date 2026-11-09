import { render } from '@testing-library/react';

import { HighlightedText } from './HighlightedText';
import { marked } from './testData';

describe('HighlightedText', () => {
  it('marks the matched pieces', () => {
    const { container } = render(<p><HighlightedText segments={marked('Sea Breeze, ', ['Goa'], ' beach')} text="ignored" /></p>);

    expect(container.querySelector('p')).toHaveTextContent('Sea Breeze, Goa beach');
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Goa']);
  });

  it('shows the plain text without pieces, or with malformed ones', () => {
    const { container, rerender } = render(<p><HighlightedText segments={null} text="Sea Breeze Resort" /></p>);
    expect(container.querySelector('p')).toHaveTextContent('Sea Breeze Resort');
    expect(container.querySelector('mark')).toBeNull();

    rerender(<p><HighlightedText segments={[]} text="Sea Breeze Resort" /></p>);
    expect(container.querySelector('p')).toHaveTextContent('Sea Breeze Resort');

    rerender(<p><HighlightedText segments={[{ text: 7, match: true }] as never} text="Sea Breeze Resort" /></p>);
    expect(container.querySelector('p')).toHaveTextContent('Sea Breeze Resort');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('shows markup in a piece as text and never creates elements from it', () => {
    const { container } = render(
      <p>
        <HighlightedText
          segments={[{ text: '<script>alert(1)</script>', match: true }, { text: '<img src=x onerror="alert(2)">', match: false }]}
          text="fallback"
        />
      </p>,
    );

    expect(container.querySelector('p')).toHaveTextContent('<script>alert(1)</script><img src=x onerror="alert(2)">');
    expect(container.querySelector('mark')).toHaveTextContent('<script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});
