import type { ComponentType } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle, ArrowRight, BarChart3, Bed, Bell, Building2, Calendar, ClipboardList, Hotel, Image, Inbox, LayoutDashboard,
  LifeBuoy, Luggage, MessageSquarePlus, Plane, Search, Shield, SlidersHorizontal, Star, Tag, Undo2, User, Users, Wallet,
} from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { useManagerHotels } from '@/features/hotel-manager/useManagerHotels';
import { cn } from '@/lib/cn';
import { hasAnyRole } from '@/lib/auth/types';
import { needsHotels, resolveAction, type ManagedHotel } from './assistantRoutes';
import type { ChatAction } from './blocks';

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  luggage: Luggage,
  wallet: Wallet,
  bell: Bell,
  'life-buoy': LifeBuoy,
  'message-square-plus': MessageSquarePlus,
  user: User,
  users: Users,
  sliders: SlidersHorizontal,
  shield: Shield,
  star: Star,
  'layout-dashboard': LayoutDashboard,
  tag: Tag,
  building: Building2,
  plane: Plane,
  'clipboard-list': ClipboardList,
  undo: Undo2,
  'bar-chart': BarChart3,
  hotel: Hotel,
  image: Image,
  bed: Bed,
  calendar: Calendar,
  inbox: Inbox,
  search: Search,
  'alert-triangle': AlertTriangle,
};

/**
 * The buttons under an answer. Each is a route KEY from the server; `resolveAction` turns it into a page of this app, and
 * drops it when the key is not in the allowlist, the user's role may not see it, or the hotel is not one of the manager's.
 * Navigation is React Router's `navigate` (no page reload), and `onNavigate` lets the panel step aside afterwards.
 */
export function AnswerActions({ actions, onNavigate }: { actions: ChatAction[]; onNavigate?: () => void }) {
  const { user } = useAuth();
  const wantsHotels = needsHotels(actions) && hasAnyRole(user, ['HOTEL_MANAGER']);
  if (actions.length === 0 || !user) return null;
  return wantsHotels ? <WithHotels actions={actions} onNavigate={onNavigate} /> : <Buttons actions={actions} hotels={undefined} onNavigate={onNavigate} />;
}

/** Loads the manager's own hotels (the same cached query as the portal) to find the id behind a hotel name. */
function WithHotels({ actions, onNavigate }: { actions: ChatAction[]; onNavigate?: () => void }) {
  const hotels = useManagerHotels();
  const own: ManagedHotel[] | undefined = hotels.data?.map((hotel) => ({ id: hotel.id, name: hotel.name }));
  return <Buttons actions={actions} hotels={own} onNavigate={onNavigate} />;
}

function Buttons({ actions, hotels, onNavigate }: { actions: ChatAction[]; hotels: ManagedHotel[] | undefined; onNavigate?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const seen = new Set<string>();
  const buttons = actions
    .map((action) => ({ action, target: resolveAction(action, user, hotels) }))
    .filter((entry): entry is { action: ChatAction; target: NonNullable<typeof entry.target> } => {
      if (!entry.target || seen.has(entry.target.to)) return false;
      seen.add(entry.target.to);
      return true;
    });
  if (buttons.length === 0) return null;
  return (
    <ul aria-label="Related pages" className="flex flex-wrap gap-2">
      {buttons.map(({ target }) => {
        const Icon = ICONS[target.icon] ?? ArrowRight;
        return (
          <li key={target.to}>
            <button
              type="button"
              onClick={() => {
                void navigate(target.to);
                onNavigate?.();
              }}
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-full bg-role-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm',
                'transition-[transform,background-color,box-shadow] duration-(--duration-fast) hover:-translate-y-0.5 hover:bg-role-700 hover:shadow-md',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-700 motion-reduce:transform-none',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {target.label}
              <ArrowRight className="size-3.5 opacity-70 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
