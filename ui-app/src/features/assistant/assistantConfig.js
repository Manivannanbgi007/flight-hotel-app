import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';
import { areaOfPath } from '@/lib/auth/portals';

/**
 * The part of the assistant that lives in the main bundle (with the launcher): the config query and the rules for
 * showing the launcher. Everything else (panel, streaming, voice) is loaded when the launcher is first used.
 */

/** The contract's limits, used when the server leaves one out. */
export const DEFAULT_LIMITS = {
  maxMessageLength: 2000,
  maxAudioBytes: 5 * 1024 * 1024,
  maxAudioSeconds: 60,
  maxSpeechChars: 1000,
};

const positive = (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** Reads the config defensively: anything unexpected means "not available" rather than a broken widget. */
export function normalizeConfig(data) {
  const raw = data && typeof data === 'object' ? data : {};
  const voice = raw.voice && typeof raw.voice === 'object' ? raw.voice : {};
  const limits = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
  return {
    enabled: raw.enabled === true,
    model: typeof raw.model === 'string' ? raw.model : '',
    voice: { transcription: voice.transcription === true, speech: voice.speech === true },
    limits: {
      maxMessageLength: positive(limits.maxMessageLength, DEFAULT_LIMITS.maxMessageLength),
      maxAudioBytes: positive(limits.maxAudioBytes, DEFAULT_LIMITS.maxAudioBytes),
      maxAudioSeconds: positive(limits.maxAudioSeconds, DEFAULT_LIMITS.maxAudioSeconds),
      maxSpeechChars: positive(limits.maxSpeechChars, DEFAULT_LIMITS.maxSpeechChars),
    },
  };
}

export async function fetchAssistantConfig() {
  const { data } = await apiClient.get('/assistant/config');
  return normalizeConfig(data);
}

/**
 * One cached config query for the whole app, only while signed in. It is checked again whenever the window regains
 * focus and, while the model is not available yet (Ollama starting, model downloading), every minute.
 */
export function useAssistantConfig(signedIn) {
  return useQuery({
    queryKey: queryKeys.assistant.config,
    queryFn: fetchAssistantConfig,
    enabled: signedIn,
    staleTime: 60_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => (query.state.data?.enabled === false ? 60_000 : false),
  });
}

/** `/login`, `/customer/login`, `/admin/login`, … (full-screen sign-in pages: no launcher there). */
export function isSignInPath(pathname) {
  return /^\/((customer|admin|hotel-manager|support)\/)?login\/?$/.test(pathname);
}

/** The launcher shows only for a signed-in user, when the server says the assistant works, and not on sign-in pages. */
export function shouldShowLauncher({ status, config, pathname }) {
  return status === 'authenticated' && config?.enabled === true && !isSignInPath(pathname);
}

/** The portal accent of the page (DESIGN_SYSTEM.md "Role accent"): brand on public and customer pages. */
export function accentClassOf(pathname) {
  const area = areaOfPath(pathname);
  if (area === 'admin') return 'role-admin';
  if (area === 'hotel-manager') return 'role-manager';
  if (area === 'support') return 'role-support';
  return '';
}
