import { writeFileSync } from 'node:fs';
import { assistantPatch, credentialName, credentialPayload, normalizePublicUrl, redact } from './payload';

// Points the user's EXISTING Vapi assistant at the RelayPay agent (custom LLM + webhook).
// It never creates an assistant, changes only model/server/serverMessages (plus firstMessage when asked),
// and with --dry-run it prints what it would send without changing anything.
//
//   npm run vapi:setup -- --url https://xyz.trycloudflare.com [--dry-run] [--first-message "..."]

const API = 'https://api.vapi.ai';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dryRun = process.argv.includes('--dry-run');

function need(name: string, min = 1): string {
  const v = process.env[name] ?? '';
  if (v.length < min) {
    console.error(`Missing or invalid environment variables: ${name}`);
    process.exit(1);
  }
  return v;
}

const apiKey = need('VAPI_API_KEY');
const assistantId = need('VAPI_ASSISTANT_ID');
const agentToken = need('AGENT_API_TOKEN', 16);
const webhookSecret = need('VAPI_WEBHOOK_SECRET', 8);

let baseUrl: string;
try {
  baseUrl = normalizePublicUrl(arg('--url') ?? process.env.AGENT_PUBLIC_URL ?? '');
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

async function vapi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const detail = typeof json === 'string' ? json : JSON.stringify(json);
    throw new Error(`Vapi ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return json as Record<string, any>;
}

function describe(a: Record<string, any>) {
  return {
    name: a.name,
    model: { provider: a.model?.provider, model: a.model?.model, url: a.model?.url },
    voice: { provider: a.voice?.provider, voiceId: a.voice?.voiceId },
    transcriber: { provider: a.transcriber?.provider, model: a.transcriber?.model },
    firstMessage: a.firstMessage,
    server: a.server?.url,
    serverMessages: a.serverMessages,
  };
}

try {
  const current = await vapi('GET', `/assistant/${assistantId}`);
  console.log('Existing assistant (will be modified, not replaced):');
  console.log(JSON.stringify(describe(current), null, 2));

  // Credential that makes Vapi send our token as a bearer header to the agent endpoint.
  const credentials = (await vapi('GET', '/credential')) as unknown as Record<string, any>[];
  const credName = credentialName(assistantId);
  const existing = credentials.find((c) => c.provider === 'custom-llm' && c.name === credName);
  console.log(
    `\nCredential "${credName}": ${existing ? `exists (${existing.id}), its key will be refreshed` : 'will be created'}`,
  );

  let credentialId = existing?.id as string | undefined;
  if (!dryRun) {
    if (existing) await vapi('PATCH', `/credential/${existing.id}`, { apiKey: agentToken });
    else credentialId = (await vapi('POST', '/credential', credentialPayload(credName, agentToken))).id;
  }

  const patch = assistantPatch({
    baseUrl,
    credentialId: credentialId ?? '<new credential id>',
    webhookSecret,
    firstMessage: arg('--first-message'),
  });
  console.log('\nChanges to the assistant:');
  console.log(JSON.stringify(redact(patch), null, 2));
  console.log('\nLeft as configured: voice, transcriber, name, and everything else not listed above.');

  if (dryRun) {
    console.log('\n--dry-run: nothing was changed in Vapi.');
  } else {
    // Keep the previous LLM and webhook settings so the change can be undone by hand.
    const backup = `vapi-assistant-backup-${assistantId.slice(0, 8)}.json`;
    writeFileSync(
      backup,
      JSON.stringify({ model: current.model, server: current.server, serverMessages: current.serverMessages, firstMessage: current.firstMessage }, null, 2),
    );
    console.log(`
Saved the previous settings to ${backup} (git-ignored).`);
    const updated = await vapi('PATCH', `/assistant/${assistantId}`, patch);
    console.log('\nUpdated assistant:');
    console.log(JSON.stringify(describe(updated), null, 2));
  }
} catch (error) {
  console.error((error as Error).message.replaceAll(apiKey, '<hidden>').replaceAll(agentToken, '<hidden>'));
  process.exit(1);
}
