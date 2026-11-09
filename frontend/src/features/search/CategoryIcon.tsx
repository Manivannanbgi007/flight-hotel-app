import { createElement } from 'react';

import { categoryIcon } from './searchModel';

/** The lucide icon of a search category (decorative: the category's name is always written next to it). */
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  return createElement(categoryIcon(category), { className, 'aria-hidden': true });
}
