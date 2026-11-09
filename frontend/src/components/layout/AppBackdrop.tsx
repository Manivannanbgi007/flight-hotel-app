/**
 * The colourful canvas of the staff portals and the customer area: a fixed layer behind the page with a soft mesh of
 * colour and three blurred blobs that drift slowly. Decorative (aria-hidden, no pointer events); the drift stops under
 * `prefers-reduced-motion`. Put it first inside a `relative isolate` wrapper.
 */
export function AppBackdrop({ within = false }: {
  /** Fill the wrapper instead of the window (the customer area, which has a footer below it that must stay untouched). */
  within?: boolean;
}) {
  return (
    <div aria-hidden="true" className={`app-aurora-mesh pointer-events-none inset-0 -z-10 overflow-hidden ${within ? 'absolute' : 'fixed'}`}>
      <span className="absolute -left-[8%] top-[6%] size-[34rem] rounded-full bg-sky-300/35 blur-3xl motion-safe:animate-[aurora-a_26s_ease-in-out_infinite]" />
      <span className="absolute -right-[6%] top-[18%] size-[30rem] rounded-full bg-violet-300/35 blur-3xl motion-safe:animate-[aurora-b_32s_ease-in-out_infinite]" />
      <span className="absolute bottom-[-8%] left-[28%] size-[32rem] rounded-full bg-pink-200/40 blur-3xl motion-safe:animate-[aurora-c_36s_ease-in-out_infinite]" />
    </div>
  );
}
