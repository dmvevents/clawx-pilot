/**
 * CLWX-99 live check: cron schedules created through the app resolve in the
 * principal's wall-clock, not the gateway process's cached timezone.
 *
 * Two legs against the RUNNING app (host-API :13210, token recovered via
 * KERN_PROCARGS2 — used in memory, never logged):
 *
 *   A. Creation surface — POST /api/cron/jobs with a bare expr string and
 *      assert the stored schedule carries tz and nextRun lands at the expected
 *      SYSTEM wall-clock minute within 26h. This leg exercises the build that
 *      is actually running: it FAILS against a pre-fix build (documenting the
 *      live defect) and passes once a build with cronScheduleFrom() ships.
 *   B. Mechanism — PUT an explicit {kind:'cron', expr, tz:<system zone>} and
 *      assert nextRun lands at the expected wall-clock. This proves the
 *      gateway honors schedule.tz end-to-end through the app route — the
 *      mechanism the fix rides — independent of the running build.
 *
 * The single test job is deleted in a finally block and removal is verified;
 * its payload instructs the agent to do nothing if it ever fires.
 *
 * Run: pnpm exec tsx scripts/clwx99-tz-check.ts
 * Exit: 0 both legs PASS / 1 any leg FAIL / 2 lane not ready (app down,
 * token unrecoverable).
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { systemTimeZone } from '../electron/utils/cron-tz';

const APP_NAME = 'Ministry of Education';
const HOST_API_PORT = 13210;
const JOB_NAME = 'CLWX-99 tz check (harness — safe to delete)';
const EXPR = '59 23 * * *';
const SAFE_MESSAGE =
  'CLWX-99 timezone harness job. If this ever fires, reply with the single word OK and do nothing else '
  + '— do not open, fill, or submit anything, and do not send any email.';

function log(msg: string): void { console.log(msg); }
function notReady(msg: string): never { console.log(`LANE NOT READY: ${msg}`); process.exit(2); }

// ── Host-API token recovery (KERN_PROCARGS2, never logged) ───────────────────

const PROCARGS_SNIPPET = `
import ctypes, ctypes.util, struct, sys
libc = ctypes.CDLL(ctypes.util.find_library('c'))
pid = int(sys.argv[1])
mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2
size = ctypes.c_size_t(0)
if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0: sys.exit(1)
buf = ctypes.create_string_buffer(size.value)
if libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) != 0: sys.exit(1)
for s in buf.raw[4:size.value].split(b'\\x00'):
    if s.startswith(b'CLAWX_HOST_API_TOKEN='):
        sys.stdout.write(s.split(b'=', 1)[1].decode()); sys.exit(0)
sys.exit(3)
`;

function findGatewayPid(appPid: number): number | null {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf-8' });
  if (ps.status !== 0) return null;
  for (const line of ps.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    if (Number(m[2]) === appPid && /openclaw-gateway/.test(m[3])) return Number(m[1]);
  }
  return null;
}

function recoverHostApiToken(): string {
  const env = process.env.CLAWX_HOST_API_TOKEN;
  if (env && env.trim()) return env.trim();
  const pg = spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS/${APP_NAME}$`], { encoding: 'utf-8' });
  const appPid = Number(pg.stdout.trim().split('\n')[0]);
  if (pg.status !== 0 || !appPid) notReady(`app "${APP_NAME}" is not running`);
  const gatewayPid = findGatewayPid(appPid);
  if (!gatewayPid) notReady(`no openclaw-gateway child of app pid ${appPid}`);
  const res = spawnSync('python3', ['-c', PROCARGS_SNIPPET, String(gatewayPid)], { encoding: 'utf-8', timeout: 15_000 });
  const token = (res.stdout ?? '').trim();
  if (res.status !== 0 || !token) notReady(`could not recover host-API token (python exit ${res.status})`);
  return token;
}

// ── Host-API client ──────────────────────────────────────────────────────────

function api(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<{ status: number | null; json: unknown }> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: HOST_API_PORT,
        path,
        method,
        timeout: 15_000,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => {
          let json: unknown = null;
          try { json = JSON.parse(data); } catch { /* non-JSON body */ }
          resolve({ status: res.statusCode ?? null, json });
        });
      },
    );
    req.on('error', () => resolve({ status: null, json: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: null, json: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}

interface UiCronJob {
  id?: string;
  name?: string;
  schedule?: { kind?: string; expr?: string; tz?: string };
  nextRun?: string;
}

/** Wall-clock HH:MM of an instant in a zone (independent arbiter via Intl). */
function wallClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso));
}

function judgeLeg(
  leg: string,
  job: UiCronJob | null,
  zone: string,
  expectTzEcho: boolean,
): boolean {
  if (!job || !job.nextRun) {
    log(`  ${leg}: FAIL — no job/nextRun in response`);
    return false;
  }
  const clock = wallClock(job.nextRun, zone);
  const deltaH = (new Date(job.nextRun).getTime() - Date.now()) / 3_600_000;
  const clockOk = clock === '23:59';
  const soonOk = deltaH > 0 && deltaH < 26;
  const tzOk = !expectTzEcho || job.schedule?.tz === zone;
  log(`  ${leg}: nextRun=${job.nextRun} -> ${clock} ${zone} (${deltaH.toFixed(1)}h out), schedule.tz=${job.schedule?.tz ?? '(absent)'}`);
  if (!clockOk) log(`  ${leg}: FAIL — expected 23:59 ${zone} wall-clock, got ${clock}`);
  if (!soonOk) log(`  ${leg}: FAIL — nextRun not within 26h (the year-out class)`);
  if (!tzOk) log(`  ${leg}: FAIL — schedule.tz not pinned to ${zone}`);
  return clockOk && soonOk && tzOk;
}

async function main() {
  const zone = systemTimeZone();
  log(`CLWX-99 tz check — system zone ${zone}, expr "${EXPR}" (23:59 daily)`);
  const token = recoverHostApiToken();

  let jobId: string | undefined;
  let pass = true;
  try {
    // Leg A: creation surface of the RUNNING build.
    const created = await api('POST', '/api/cron/jobs', token, {
      name: JOB_NAME, message: SAFE_MESSAGE, schedule: EXPR, enabled: true,
    });
    if (created.status !== 200) notReady(`POST /api/cron/jobs -> HTTP ${created.status}`);
    const createdJob = created.json as UiCronJob;
    jobId = createdJob?.id;
    if (!jobId) notReady('POST returned no job id');
    log('Leg A — creation surface (running build):');
    const legA = judgeLeg('A', createdJob, zone, true);
    pass = legA && pass;

    // Leg B: explicit tz through PUT — the mechanism the fix rides.
    const updated = await api('PUT', `/api/cron/jobs/${jobId}`, token, {
      schedule: { kind: 'cron', expr: EXPR, tz: zone },
    });
    if (updated.status !== 200) { log(`  B: FAIL — PUT -> HTTP ${updated.status}`); pass = false; }
    else {
      log('Leg B — gateway honors explicit schedule.tz:');
      pass = judgeLeg('B', updated.json as UiCronJob, zone, true) && pass;
    }
  } finally {
    if (jobId) {
      const del = await api('DELETE', `/api/cron/jobs/${jobId}`, token);
      const list = await api('GET', '/api/cron/jobs', token);
      const still = Array.isArray(list.json) && (list.json as UiCronJob[]).some((j) => j.id === jobId);
      log(`Cleanup: DELETE -> HTTP ${del.status}; job still listed: ${still}`);
      if (still) {
        log('CLEANUP FAILURE — harness job remains; delete it via the Cron Tasks UI');
        pass = false;
      }
    }
  }

  if (!pass) { log('\nCLWX99 FAIL — at least one leg failed (see above)'); process.exit(1); }
  log('\nCLWX99 PASS — creation surface pins tz and nextRun lands at system wall-clock');
  process.exit(0);
}

main().catch((err) => {
  console.error(`INFRA: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
