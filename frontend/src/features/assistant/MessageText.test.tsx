import { render, screen } from '@testing-library/react';

import { nextSentences, parseInline, parseMessageText, plainText } from './messageFormat';
import { MessageText } from './MessageText';

describe('MessageText (plain text only)', () => {
  it('keeps a URL as text: no link, no auto-linking', () => {
    const { container } = render(<MessageText text="Pay at https://pay.example.com/HT-1 or www.example.org today." />);

    expect(screen.getByText('Pay at https://pay.example.com/HT-1 or www.example.org today.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
  });

  it('shows HTML and Markdown links as the characters they are', () => {
    const text = '<b>bold?</b> [My Trips](https://evil.example) <script>alert(1)</script>';
    const { container } = render(<MessageText text={text} />);

    expect(container.textContent).toBe(text);
    expect(container.querySelector('b, script, a')).toBeNull();
  });

  it('keeps line breaks and renders simple lists and bold', () => {
    const { container } = render(<MessageText text={'You have two trips:\n- **HT-7K3M9Q2X** Goa\n- HT-ANSB6KZ8 Delhi\n\n1. First\n2. Second\nLine one\nline two'} />);

    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['HT-7K3M9Q2X Goa', 'HT-ANSB6KZ8 Delhi', 'First', 'Second']);
    expect(screen.getByText('HT-7K3M9Q2X').tagName).toBe('STRONG');
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });
});

describe('MessageText: tables the model writes', () => {
  const table = [
    'Hotels in Goa:',
    '| Hotel | Type | Price per Night |',
    '|-------|:----:|----------------:|',
    '| **Sea Breeze Resort** | Resort | ₹7,638 |',
    '| Panjim Heritage Inn | Guest House | ₹3,942 |',
    'Prices include taxes.',
  ].join('\n');

  it('shows each row as a card with "column: value" pairs, never the pipes', () => {
    const { container } = render(<MessageText text={table} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Sea Breeze Resort');
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual(['Type', 'Price per Night', 'Type', 'Price per Night']);
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toEqual(['Resort', '₹7,638', 'Guest House', '₹3,942']);
    expect(container.textContent).not.toContain('|');
    expect(screen.getByText('Prices include taxes.')).toBeInTheDocument();
  });

  it('reads a table aloud without pipes or rule lines', () => {
    expect(plainText(table)).toBe('Hotels in Goa:\nHotel, Type, Price per Night\nSea Breeze Resort, Resort, ₹7,638\nPanjim Heritage Inn, Guest House, ₹3,942\nPrices include taxes.');
  });

  it('a lone pipe line without the rule stays text; narrow spaces become normal spaces', () => {
    expect(parseMessageText('| just text |')[0]?.kind).toBe('paragraph');
    render(<MessageText text={'From 20\u202FDecember\u202F2026, 8.9\u202Fkm'} />);
    expect(screen.getByText('From 20 December 2026, 8.9 km')).toBeInTheDocument();
  });
});

describe('messageFormat', () => {
  it('splits paragraphs, bullets and numbered lists', () => {
    expect(parseMessageText('Intro\n\n- a\n* b\n3. c\n4) d').map((block) => block.kind)).toEqual(['paragraph', 'bullets', 'numbers']);
    expect(parseMessageText('3. c')[0]).toMatchObject({ kind: 'numbers', start: 3 });
  });

  it('drops a ** whose partner has not arrived yet (streaming)', () => {
    expect(parseInline('There are **5 open')).toEqual([{ text: 'There are 5 open', bold: false }]);
    expect(parseInline('**5** open')).toEqual([{ text: '5', bold: true }, { text: ' open', bold: false }]);
    expect(plainText('**Total:** ₹6,300\n- one')).toBe('Total: ₹6,300\none');
  });

  it('gives whole sentences for the screen reader, not single words', () => {
    expect(nextSentences('You have', 0)).toBeNull();
    expect(nextSentences('You have two trips. The first', 0)).toEqual({ chunk: 'You have two trips.', to: 19 });
    expect(nextSentences('You have two trips. The first is in Goa. Then', 19)).toEqual({ chunk: 'The first is in Goa.', to: 40 });
    // A decimal point is not a sentence end.
    expect(nextSentences('It costs ₹9,609.60 in total', 0)).toBeNull();
  });
});
