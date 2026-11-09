import { MAILPIT_URL } from './env';
import { eventually } from './wait';

/** Reads the e-mails the stack sent (every e-mail goes to Mailpit locally, API at /api/v1). */
interface MessageSummary {
  ID: string;
  Subject: string;
}

async function messagesTo(address: string): Promise<MessageSummary[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  if (!response.ok) {
    throw new Error(`Mailpit search answered ${response.status}`);
  }
  const body = (await response.json()) as { messages?: MessageSummary[] };
  return body.messages ?? [];
}

async function messageText(id: string): Promise<string> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!response.ok) {
    throw new Error(`Mailpit message answered ${response.status}`);
  }
  return ((await response.json()) as { Text?: string }).Text ?? '';
}

/**
 * The path of the verification link (`/verify-email?token=…`) e-mailed to `address`, without the host, so it opens
 * on whatever base URL the tests run against.
 */
export async function verificationPath(address: string): Promise<string> {
  const message = await eventually(`the verification e-mail to ${address}`, async () => (await messagesTo(address))[0]);
  const link = /https?:\/\/[^\s"<>]+\/verify-email\?token=[^\s"<>]+/.exec(await messageText(message.ID))?.[0];
  if (!link) {
    throw new Error(`No verification link in the e-mail "${message.Subject}"`);
  }
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
}
