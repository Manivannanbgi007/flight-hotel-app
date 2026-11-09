import { EmptyInboxIllustration, LostIllustration } from '@/components/illustrations';

/**
 * The drawing at the top of the newsletter pages' card (decorative): the inbox for subscribe and unsubscribe, the
 * signpost for a link that does not work.
 */
export function NewsletterArt({ kind }: { kind: 'inbox' | 'lost' }) {
  const Drawing = kind === 'lost' ? LostIllustration : EmptyInboxIllustration;
  return (
    <div className="mb-4 flex justify-center animate-fade-in">
      {/* The size is on the wrapper: the drawing fills its box. */}
      <div className="w-36"><Drawing /></div>
    </div>
  );
}
