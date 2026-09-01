/*
 * Fixture validation harness.
 *
 * The fixtures under src/providers/__fixtures__ are documentation-derived. Before
 * publishing, they must be checked against REAL test-mode webhooks. This script
 * runs the actual payhooks verify() + normalize() on a real payload and diffs its
 * structure against the matching fixture, so drift shows up as a report instead of
 * a production surprise.
 *
 * Three modes:
 *   serve (default)  start a capture server; every webhook that hits it is verified,
 *                    normalized, saved to tools/captured/, and diffed live.
 *   --file <path>    validate one saved raw payload file (paste the body a dashboard shows).
 *   --diff-only      re-diff everything already in tools/captured/ against the fixtures.
 *
 * Run:  npm run validate:fixtures            (serve)
 *       npm run validate:file -- --file tools/captured/x.json --provider paystack
 *       npm run validate:diff
 */
import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { paystack } from '../src/providers/paystack.js';
import { flutterwave } from '../src/providers/flutterwave.js';
import type { Provider, PaymentProvider } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixturesDir = join(root, 'src', 'providers', '__fixtures__');
const capturedDir = join(here, 'captured');

const PROVIDERS: Record<PaymentProvider, Provider> = { paystack, flutterwave };

// Header a provider tags requests with, used to auto-detect the sender.
const DETECT_HEADER: Record<PaymentProvider, string> = {
  paystack: 'x-paystack-signature',
  flutterwave: 'verif-hash',
};

// Normalized event type -> the fixture file it should match, per provider.
const FIXTURE_FOR: Record<PaymentProvider, Record<string, string>> = {
  paystack: {
    'charge.success': 'charge.success.json',
    refund: 'refund.json',
    unknown: 'unknown.json',
  },
  flutterwave: {
    'charge.success': 'charge.completed.json',
    'charge.failed': 'charge.completed.json',
    refund: 'refund.json',
    unknown: 'unknown.json',
  },
};

// Dotted paths the normalizer actually reads. Drift here is what breaks it.
const CRITICAL: Record<PaymentProvider, { path: string; note: string; alt?: string }[]> = {
  paystack: [
    { path: 'event', note: 'drives the type map (exact string matters)' },
    { path: 'data.id', note: 'dedup key; absence falls back to reference' },
    { path: 'data.reference', note: 'reference' },
    { path: 'data.amount', note: 'kobo -> major (/100)' },
    { path: 'data.currency', note: 'currency' },
    { path: 'data.customer.email', note: 'customer email' },
    { path: 'data.customer.first_name', note: 'customer name' },
    { path: 'data.customer.last_name', note: 'customer name' },
  ],
  flutterwave: [
    { path: 'event', note: 'drives type; also checked as event.type', alt: 'event.type' },
    { path: 'data.id', note: 'dedup key (composed with type)' },
    { path: 'data.tx_ref', note: 'reference', alt: 'data.reference' },
    { path: 'data.amount', note: 'amount (major units)', alt: 'data.amount_refunded' },
    { path: 'data.currency', note: 'currency' },
    { path: 'data.status', note: 'successful vs failed for charge.completed' },
    { path: 'data.customer.email', note: 'customer email' },
    { path: 'data.customer.name', note: 'customer name' },
  ],
};

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
const tag = {
  pass: `${C.green}[PASS]${C.reset}`,
  fail: `${C.red}[FAIL]${C.reset}`,
  warn: `${C.yellow}[WARN]${C.reset}`,
  drift: `${C.yellow}[DRIFT]${C.reset}`,
  skip: `${C.dim}[SKIP]${C.reset}`,
  info: `${C.cyan}[INFO]${C.reset}`,
};

function detectProvider(headers: Record<string, string | undefined>): PaymentProvider | null {
  for (const name of Object.keys(PROVIDERS) as PaymentProvider[]) {
    const target = DETECT_HEADER[name];
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === target && headers[key]) return name;
    }
  }
  return null;
}

function getHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === target) return headers[key];
  return undefined;
}

// All dotted key-paths present in an object (arrays descend into [0] as `[]`).
function collectPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== 'object') {
    if (prefix) out.add(prefix);
    return out;
  }
  if (Array.isArray(value)) {
    if (prefix) out.add(prefix);
    if (value.length) collectPaths(value[0], `${prefix}[]`, out);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    collectPaths(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

function valueAtPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

interface Report {
  ok: boolean;
  lines: string[];
}

function validate(
  provider: PaymentProvider,
  raw: string,
  headers: Record<string, string | undefined>,
  secret: string | undefined,
): Report {
  const lines: string[] = [];
  let ok = true;
  const push = (s: string) => lines.push(s);

  const impl = PROVIDERS[provider];

  // 1. Signature.
  if (secret) {
    const verified = impl.verify(raw, headers, secret);
    if (verified) push(`  ${tag.pass} signature verified with the provided secret`);
    else {
      ok = false;
      push(`  ${tag.fail} signature did NOT verify. Check the secret, and that the raw body is byte-exact.`);
    }
  } else {
    push(`  ${tag.skip} signature check (no secret in env for ${provider})`);
  }

  // 2. Parse + normalize (this is what payhooks produces from the real payload).
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, lines: [...lines, `  ${tag.fail} body is not valid JSON`] };
  }

  let normalized;
  try {
    normalized = impl.normalize(raw, headers);
  } catch (err) {
    return { ok: false, lines: [...lines, `  ${tag.fail} normalize() threw: ${(err as Error).message}`] };
  }
  push(`  ${tag.info} normalized event:`);
  const shown = { ...normalized, raw: '<omitted>' };
  for (const [k, v] of Object.entries(shown)) push(`         ${k}: ${JSON.stringify(v)}`);
  if (normalized.type === 'unknown') {
    push(`  ${tag.warn} type resolved to "unknown". Expected only for genuinely unmapped events; if you fired a charge/refund, the event string drifted from the type map.`);
  }

  const eventName =
    (valueAtPath(parsed, 'event') as string) ?? (valueAtPath(parsed, 'event.type') as string) ?? '';
  const fixtureFile = FIXTURE_FOR[provider][normalized.type];

  // 3. Critical fields the normalizer depends on.
  push(`  ${tag.info} critical fields (what the normalizer reads):`);
  for (const field of CRITICAL[provider]) {
    let v = valueAtPath(parsed, field.path);
    let usedPath = field.path;
    if (v === undefined && field.alt) {
      v = valueAtPath(parsed, field.alt);
      if (v !== undefined) usedPath = field.alt;
    }
    const optional = field.path.includes('customer') || field.path === 'data.id';
    if (v === undefined) {
      if (optional) push(`         ${tag.warn} ${field.path} absent (${field.note})`);
      else {
        ok = false;
        push(`         ${tag.fail} ${field.path} absent -> ${field.note}`);
      }
    } else {
      push(`         ${tag.pass} ${usedPath} = ${JSON.stringify(v)} (${typeOf(v)})`);
    }
  }

  // 4. Structural diff against the matching fixture.
  if (!fixtureFile || !existsSync(join(fixturesDir, provider, fixtureFile))) {
    push(`  ${tag.warn} no fixture maps to type "${normalized.type}", skipping structural diff`);
    return { ok, lines };
  }
  const fixtureRaw = readFileSync(join(fixturesDir, provider, fixtureFile), 'utf8');
  const fixture = JSON.parse(fixtureRaw);
  push(`  ${tag.info} structural diff vs ${provider}/${fixtureFile}:`);

  // 4a. The literal strings that steer the type map.
  const fixtureEvent =
    (valueAtPath(fixture, 'event') as string) ?? (valueAtPath(fixture, 'event.type') as string) ?? '';
  if (eventName !== fixtureEvent) {
    push(`         ${tag.drift} event string: real "${eventName}" vs fixture "${fixtureEvent}"`);
  } else {
    push(`         ${tag.pass} event string matches ("${eventName}")`);
  }
  if (provider === 'flutterwave') {
    const rs = valueAtPath(parsed, 'data.status');
    const fs = valueAtPath(fixture, 'data.status');
    if (rs !== fs) push(`         ${tag.drift} data.status: real ${JSON.stringify(rs)} vs fixture ${JSON.stringify(fs)}`);
  }

  // 4b. Key-path set difference.
  const realPaths = collectPaths(parsed);
  const fixturePaths = collectPaths(fixture);
  const missing = [...fixturePaths].filter((p) => !realPaths.has(p)).sort();
  const extra = [...realPaths].filter((p) => !fixturePaths.has(p)).sort();

  if (!missing.length && !extra.length) {
    push(`         ${tag.pass} key structure identical`);
  } else {
    if (missing.length) {
      push(`         ${tag.drift} in fixture but NOT in real payload (${missing.length}):`);
      for (const p of missing) push(`             - ${p}`);
    }
    if (extra.length) {
      push(`         ${tag.warn} in real payload but NOT in fixture (${extra.length}):`);
      for (const p of extra) push(`             + ${p}`);
    }
    push(`         ${C.dim}Extra keys are usually fine. Missing keys the normalizer reads are the risk.${C.reset}`);
  }

  return { ok, lines };
}

function reportName(provider: PaymentProvider, type: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${provider}.${type}.${stamp}.json`;
}

function printReport(title: string, report: Report): void {
  console.log(`\n${C.bold}${title}${C.reset}`);
  for (const l of report.lines) console.log(l);
  console.log(
    report.ok
      ? `  ${tag.pass} ${C.bold}overall: usable${C.reset}`
      : `  ${tag.fail} ${C.bold}overall: needs a fix (see above)${C.reset}`,
  );
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function serve(): void {
  const port = Number(process.env.PORT ?? 4000);
  const secrets: Record<PaymentProvider, string | undefined> = {
    paystack: process.env.PAYSTACK_SECRET,
    flutterwave: process.env.FLUTTERWAVE_SECRET,
  };

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(200).end('payhooks fixture-capture server. POST your webhook here.');
      return;
    }
    const rawBuf = await readBody(req);
    const raw = rawBuf.toString('utf8');
    const headers = req.headers as Record<string, string | undefined>;

    // Path override (/paystack, /flutterwave) else auto-detect by header.
    const fromPath = (req.url ?? '').replace(/\//g, '') as PaymentProvider;
    const provider =
      fromPath in PROVIDERS ? fromPath : detectProvider(headers);

    if (!provider) {
      console.log(`\n${tag.warn} received a POST but could not tell the provider (no known signature header, no /paystack or /flutterwave path).`);
      res.writeHead(400).end('unknown provider');
      return;
    }

    const type = (() => {
      try {
        return PROVIDERS[provider].normalize(raw, headers).type;
      } catch {
        return 'unparseable';
      }
    })();
    const file = join(capturedDir, reportName(provider, type));
    writeFileSync(file, raw);

    const report = validate(provider, raw, headers, secrets[provider]);
    printReport(`CAPTURED ${provider} (${type}) -> ${basename(file)}`, report);
    console.log(`  ${tag.info} saved raw payload: ${file}`);

    res.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
  });

  server.listen(port, () => {
    console.log(`${C.bold}payhooks fixture-capture server${C.reset}`);
    console.log(`Listening on ${C.cyan}http://localhost:${port}${C.reset}`);
    console.log('');
    console.log(`${tag.info} secrets: paystack ${secrets.paystack ? 'set' : `${C.yellow}unset${C.reset}`}, flutterwave ${secrets.flutterwave ? 'set' : `${C.yellow}unset${C.reset}`}`);
    console.log(`         (set PAYSTACK_SECRET / FLUTTERWAVE_SECRET to check signatures; otherwise it still captures + diffs)`);
    console.log('');
    console.log(`${C.bold}Next:${C.reset}`);
    console.log(`  1. Expose this port publicly:  ${C.cyan}npx cloudflared tunnel --url http://localhost:${port}${C.reset}`);
    console.log(`     (or: ngrok http ${port})`);
    console.log(`  2. Paste the public URL into each dashboard's webhook setting:`);
    console.log(`       Paystack:    Settings -> API Keys & Webhooks -> Webhook URL   (append /paystack)`);
    console.log(`       Flutterwave: Settings -> Webhooks -> URL                       (append /flutterwave)`);
    console.log(`  3. Fire a test event (make a test-mode charge, or use the dashboard's "Send test webhook").`);
    console.log(`  4. Read the PASS/DRIFT report printed here. Fix any fixture that drifted, then: ${C.cyan}npm test${C.reset}`);
    console.log('');
    console.log(`Waiting for webhooks... (Ctrl+C to stop)`);
  });
}

function validateFile(path: string, provider: PaymentProvider): void {
  const raw = readFileSync(path, 'utf8');
  const secret =
    provider === 'paystack' ? process.env.PAYSTACK_SECRET : process.env.FLUTTERWAVE_SECRET;
  const sigHeader = getArg('--sig-header');
  const headers: Record<string, string | undefined> = {};

  // Paystack verify needs BOTH the secret and the captured x-paystack-signature.
  // Flutterwave verify only compares verif-hash to the secret.
  let effectiveSecret: string | undefined;
  if (provider === 'paystack') {
    if (secret && sigHeader) {
      headers['x-paystack-signature'] = sigHeader;
      effectiveSecret = secret;
    }
  } else if (secret) {
    headers['verif-hash'] = secret;
    effectiveSecret = secret;
  }

  const report = validate(provider, raw, headers, effectiveSecret);
  if (provider === 'paystack' && !effectiveSecret) {
    report.lines.unshift(
      `  ${tag.info} to include the signature check, pass --sig-header <value> and set PAYSTACK_SECRET`,
    );
  }
  printReport(`FILE ${basename(path)} as ${provider}`, report);
}

function diffOnly(): void {
  if (!existsSync(capturedDir)) {
    console.log(`${tag.warn} no captured/ directory yet. Run the server and capture something first.`);
    return;
  }
  const files = readdirSync(capturedDir).filter((f) => f.endsWith('.json'));
  if (!files.length) {
    console.log(`${tag.warn} nothing in tools/captured/ yet.`);
    return;
  }
  for (const f of files) {
    const provider = f.split('.')[0] as PaymentProvider;
    if (!(provider in PROVIDERS)) continue;
    const raw = readFileSync(join(capturedDir, f), 'utf8');
    const report = validate(provider, raw, {}, undefined);
    printReport(`DIFF ${f}`, report);
  }
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (!existsSync(capturedDir)) mkdirSync(capturedDir, { recursive: true });

const mode = process.argv.includes('--diff-only')
  ? 'diff'
  : process.argv.includes('--file')
    ? 'file'
    : 'serve';

if (mode === 'diff') {
  diffOnly();
} else if (mode === 'file') {
  const path = getArg('--file')!;
  const provider = getArg('--provider') as PaymentProvider | undefined;
  if (!path || !provider || !(provider in PROVIDERS)) {
    console.error('usage: --file <path> --provider <paystack|flutterwave> [--sig-header <value>]');
    process.exit(1);
  }
  validateFile(path, provider);
} else {
  serve();
}
