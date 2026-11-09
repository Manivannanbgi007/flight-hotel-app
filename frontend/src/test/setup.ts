import '@testing-library/jest-dom/vitest';
import { toast } from 'sonner';

import { loadCalendar } from '@/components/ui/calendarLoader';

// Date fields load their calendar on first use (a separate chunk in the app). Loaded once here, every calendar in a
// test renders at once when it opens, as it does in the browser once the chunk has arrived.
await loadCalendar();

// jsdom has no pointer capture; Sonner captures the pointer when a toast is pressed (to let it be swiped away), so a
// click on a toast button threw "setPointerCapture is not a function" outside the test (an unhandled error that made
// the whole run fail although every test passed).
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// Sonner keeps its toasts in a module-level store and replays the active ones to every new <Toaster>, so a toast from
// one test would show up again in the next test of the same file. Dismiss them all after each test.
afterEach(() => {
  toast.dismiss();
});
