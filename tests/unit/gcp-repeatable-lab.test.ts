// @vitest-environment node
// Behavioral tests for windows-pilot/vm-testing/gcp-repeatable-lab.py
// (CLWX-25/106/133). Every test runs the real launcher as a subprocess with a
// fake `gcloud` executable first on PATH that logs every argv it receives and
// answers from a per-test scenario. We assert observable behavior — exit
// codes, which gcloud calls happened (or provably did not), and receipt
// contents — not static string mirrors of the source.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const launcher = path.join(repoRoot, 'windows-pilot', 'vm-testing', 'gcp-repeatable-lab.py');
const baselinePath = path.join(repoRoot, 'windows-pilot', 'vm-testing', 'lab-baseline.json');
// Names are derived from the shipped pinned config so a root rename of a lab
// resource cannot silently desynchronize these assertions (review F2).
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
  firewall: { name: string };
};

function resolvePython(): string {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('no python interpreter available for launcher tests');
}
const python = resolvePython();

// The fake gcloud: logs argv as JSON lines, then answers from the scenario.
// An argv no rule matches exits 97 — unexpected calls fail tests loudly.
const FAKE_GCLOUD_DRIVER = `
import json, os, sys
args = sys.argv[1:]
with open(os.environ['FAKE_GCLOUD_LOG'], 'a') as fh:
    fh.write(json.dumps(args) + '\\n')
joined = ' '.join(args)
for rule in json.load(open(os.environ['FAKE_GCLOUD_SCENARIO'])):
    if all(token in joined for token in rule['match']):
        sys.stdout.write(rule.get('stdout', ''))
        sys.stderr.write(rule.get('stderr', ''))
        sys.exit(rule.get('exitCode', 0))
sys.stderr.write('fake gcloud: no scenario rule matched: ' + joined)
sys.exit(97)
`;

interface Rule { match: string[]; stdout?: string; stderr?: string; exitCode?: number }

const IMG = { name: 'windows-server-2022-dc-v20260101', project: 'windows-cloud', id: '8181818181818181818' };
const NET_OK = { name: 'clawx-test-lab', autoCreateSubnetworks: false };
const SUBNET_OK = {
  name: 'clawx-test-lab-us-central1', ipCidrRange: '10.74.0.0/24',
  network: 'https://compute/projects/p/global/networks/clawx-test-lab',
  region: 'https://compute/projects/p/regions/us-central1',
};
// The real GCP API returns one allowed entry PER PORT for our restricted rule
// (raw sanitized shape confirmed by root on 2026-09-08); grouped is equivalent.
const FIREWALL_OK = {
  name: baseline.firewall.name, direction: 'INGRESS', disabled: false,
  network: 'https://compute/projects/p/global/networks/clawx-test-lab',
  sourceRanges: ['35.235.240.0/20'], targetTags: ['clawx-repeatable-test'],
  allowed: [{ IPProtocol: 'tcp', ports: ['22'] }, { IPProtocol: 'tcp', ports: ['3389'] }],
};

// Rule order matters: subnets before networks (both contain "networks list" tokens).
function happyRules(instanceName: string): Rule[] {
  return [
    { match: ['images', 'describe'], stdout: JSON.stringify({ name: IMG.name, id: IMG.id }) },
    { match: ['instances', 'list'], stdout: '[]' },
    { match: ['subnets', 'list'], stdout: JSON.stringify([SUBNET_OK]) },
    { match: ['networks', 'list'], stdout: JSON.stringify([NET_OK]) },
    { match: ['firewall-rules', 'list'], stdout: JSON.stringify([FIREWALL_OK]) },
    {
      match: ['instances', 'create'],
      stdout: JSON.stringify([{ id: '4242424242424242424', name: instanceName, status: 'RUNNING' }]),
    },
  ];
}

interface Lab {
  dir: string; home: string; receipts: string; log: string;
  scenarioPath: string; configPath: string;
}

function makeLab(rules: Rule[], imageOverride?: object): Lab {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawx-lab-test-'));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  const driver = path.join(dir, 'fake-gcloud.py');
  fs.writeFileSync(driver, FAKE_GCLOUD_DRIVER);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'gcloud.cmd'), `@echo off\r\n${python} "${driver}" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(bin, 'gcloud'), `#!/bin/sh\nexec ${python} "${driver}" "$@"\n`, { mode: 0o755 });
  }
  const scenarioPath = path.join(dir, 'scenario.json');
  fs.writeFileSync(scenarioPath, JSON.stringify(rules));
  const config = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  config.image = imageOverride ?? { ...IMG };
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const lab: Lab = {
    dir, home, receipts: path.join(dir, 'receipts'),
    log: path.join(dir, 'calls.log'), scenarioPath, configPath,
  };
  // PATH points at the fake bin first; recorded here so run() stays pure.
  fs.writeFileSync(path.join(dir, 'path.txt'), bin + path.delimiter + (process.env.PATH ?? ''));
  return lab;
}

function run(lab: Lab, args: string[]) {
  const fakePath = fs.readFileSync(path.join(lab.dir, 'path.txt'), 'utf8');
  return spawnSync(python, [launcher, ...args, '--config', lab.configPath], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: fakePath,
      Path: fakePath,
      HOME: lab.home,
      USERPROFILE: lab.home,
      FAKE_GCLOUD_LOG: lab.log,
      FAKE_GCLOUD_SCENARIO: lab.scenarioPath,
      CLOUDSDK_CONFIG: path.join(lab.home, 'cloudsdk'),
    },
  });
}

function calls(lab: Lab): string[][] {
  if (!fs.existsSync(lab.log)) return [];
  return fs.readFileSync(lab.log, 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function readReceipt(lab: Lab, runId: string) {
  return JSON.parse(fs.readFileSync(path.join(lab.receipts, `${runId}.receipt.json`), 'utf8'));
}

describe('gcp-repeatable-lab plan', () => {
  it('emits the exact argv as JSON and spawns no gcloud at all', () => {
    const lab = makeLab([]);
    const r = run(lab, ['plan', '--run-id', 'plan-ro-1']);
    expect(r.status).toBe(0);
    const plan = JSON.parse(r.stdout);
    expect(plan.mutation).toBe(false);
    expect(plan.blockers).toEqual([]);
    expect(plan.instanceName).toBe('clawx-lab-plan-ro-1');
    const create = plan.argv.instanceCreate as string[];
    expect(create).toContain('--machine-type=n2-standard-8');
    expect(create).toContain('--no-service-account');
    expect(create).toContain('--no-scopes');
    expect(create).toContain('--boot-disk-size=100GB');
    expect(create).toContain('--boot-disk-type=pd-ssd');
    expect(create).toContain('--tags=clawx-repeatable-test');
    expect(create.find((a) => a.startsWith('--metadata='))).toContain('enable-windows-ssh=TRUE');
    expect(create.find((a) => a.startsWith('--metadata='))).toContain(
      'sysprep-specialize-script-cmd=googet -noconfirm=true install google-compute-engine-ssh',
    );
    expect(create.find((a) => a.startsWith('--metadata='))).toContain('block-project-ssh-keys=TRUE');
    expect(calls(lab)).toEqual([]); // read-only: not one subprocess
  });

  it('reports blockers (exit 2) while the shipped baseline image is a placeholder', () => {
    // Uses the repo baseline as-is. Once root pins a real image, blockers
    // legitimately become empty and exit becomes 0 — both are honest states.
    const r = spawnSync(python, [launcher, 'plan', '--run-id', 'baseline-check-1'], {
      encoding: 'utf8', timeout: 30_000,
    });
    expect([0, 2]).toContain(r.status);
    const plan = JSON.parse(r.stdout);
    const hasPlaceholder = JSON.stringify(plan.image).includes('PLACEHOLDER');
    expect(plan.blockers.length > 0).toBe(hasPlaceholder);
    expect(r.status).toBe(hasPlaceholder ? 2 : 0);
  });
});

describe('gcp-repeatable-lab create refusals (no gcloud reached)', () => {
  it('refuses an invalid run-id before any gcloud call or receipt', () => {
    const lab = makeLab(happyRules('x'));
    for (const bad of ['UPPER-CASE', 'has_underscore', 'ab', '-leading', 'trailing-']) {
      const r = run(lab, ['create', '--run-id', bad, '--image', IMG.name, '--receipt-dir', lab.receipts]);
      expect(r.status).not.toBe(0);
    }
    expect(calls(lab)).toEqual([]);
    expect(fs.existsSync(lab.receipts)).toBe(false);
  });

  it('refuses a run-id colliding with the protected owner VM', () => {
    const lab = makeLab(happyRules('x'));
    const r = run(lab, ['create', '--run-id', 'clawx-win-rc-20260609', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/protected owner target/);
    expect(calls(lab)).toEqual([]);
  });

  it('refuses create while the image config is a placeholder', () => {
    const lab = makeLab(happyRules('x'), {
      name: 'PLACEHOLDER-X', project: 'windows-cloud', id: 'PLACEHOLDER-Y',
    });
    const r = run(lab, ['create', '--run-id', 'ph-refuse-1', '--image', 'PLACEHOLDER-X', '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/placeholder/);
    expect(calls(lab)).toEqual([]);
  });

  it('requires --image to exactly match the pinned config image name', () => {
    const lab = makeLab(happyRules('x'));
    const missing = run(lab, ['create', '--run-id', 'img-flag-1', '--receipt-dir', lab.receipts]);
    expect(missing.status).toBe(2);
    const wrong = run(lab, ['create', '--run-id', 'img-flag-2', '--image', 'windows-server-2022-dc-v20991231', '--receipt-dir', lab.receipts]);
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toMatch(/does not exactly match/);
    expect(calls(lab)).toEqual([]);
  });

  it('refuses a preexisting receipt and a preexisting lock without gcloud calls', () => {
    const lab = makeLab(happyRules('clawx-lab-reuse-1'));
    fs.mkdirSync(lab.receipts, { recursive: true });
    fs.writeFileSync(path.join(lab.receipts, 'reuse-1.receipt.json'), '{}');
    const r1 = run(lab, ['create', '--run-id', 'reuse-1', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r1.status).toBe(2);
    expect(r1.stderr).toMatch(/receipt already exists/);
    fs.writeFileSync(path.join(lab.receipts, 'reuse-2.lock.json'), '{}');
    const r2 = run(lab, ['create', '--run-id', 'reuse-2', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/lock already exists/);
    expect(calls(lab)).toEqual([]);
  });
});

describe('gcp-repeatable-lab create fail-closed against gcloud reality', () => {
  const createCalls = (lab: Lab) => calls(lab).filter((argv) => argv.includes('create'));

  it('refuses when the image ID readback does not match the pinned numeric ID', () => {
    const rules = happyRules('x');
    rules[0] = { match: ['images', 'describe'], stdout: JSON.stringify({ name: IMG.name, id: '999' }) };
    const lab = makeLab(rules);
    const r = run(lab, ['create', '--run-id', 'img-mismatch-1', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(1);
    expect(createCalls(lab)).toEqual([]);
    const receipt = readReceipt(lab, 'img-mismatch-1');
    expect(receipt.result).toBe('FAIL');
    expect(receipt.failure).toMatch(/image identity readback mismatch/);
    expect(receipt.instance).toBeNull();
  });

  it('refuses to reuse a preexisting VM with the same name as a fresh lab', () => {
    const rules = happyRules('clawx-lab-prior-vm-1');
    rules[1] = {
      match: ['instances', 'list'],
      stdout: JSON.stringify([{ name: 'clawx-lab-prior-vm-1', status: 'TERMINATED' }]),
    };
    const lab = makeLab(rules);
    const r = run(lab, ['create', '--run-id', 'prior-vm-1', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(1);
    expect(createCalls(lab)).toEqual([]);
    expect(readReceipt(lab, 'prior-vm-1').failure).toMatch(/never reused as a fresh lab/);
  });

  it('refuses drift in existing lab infrastructure instead of adopting it', () => {
    const rules = happyRules('x');
    rules[3] = { match: ['networks', 'list'], stdout: JSON.stringify([{ name: 'clawx-test-lab', autoCreateSubnetworks: true }]) };
    const lab = makeLab(rules);
    const r = run(lab, ['create', '--run-id', 'drift-1', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(1);
    expect(createCalls(lab)).toEqual([]);
    expect(readReceipt(lab, 'drift-1').failure).toMatch(/refusing drift/);
  });

  it('refuses PASS when instance create returns a different instance identity', () => {
    // Numeric ID present but foreign name: the receipt must not attest it.
    const lab = makeLab(happyRules('some-other-vm-name'));
    const r = run(lab, ['create', '--run-id', 'adv-wrong-name', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(1);
    const receipt = readReceipt(lab, 'adv-wrong-name');
    expect(receipt.result).toBe('FAIL');
    expect(receipt.failure).toMatch(/identity for a different instance/);
  });

  it('writes a FAIL receipt (lock consumed) when gcloud stdout is not JSON', () => {
    const rules = happyRules('clawx-lab-badjson-1');
    rules[5] = { match: ['instances', 'create'], stdout: 'Created [instance]. Human text, not JSON.' };
    const lab = makeLab(rules);
    const r = run(lab, ['create', '--run-id', 'badjson-1', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(1);
    const receipt = readReceipt(lab, 'badjson-1');
    expect(receipt.result).toBe('FAIL');
    expect(receipt.failure).toMatch(/non-JSON stdout/);
    expect(fs.existsSync(path.join(lab.receipts, 'badjson-1.lock.json'))).toBe(true);
  });

  it('fails closed when any gcloud subprocess fails', () => {
    const rules = happyRules('x');
    rules[3] = { match: ['networks', 'list'], exitCode: 1, stderr: 'ERROR: quota exceeded' };
    const lab = makeLab(rules);
    const r = run(lab, ['create', '--run-id', 'gcloud-fail-1', '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(1);
    expect(createCalls(lab)).toEqual([]);
    const receipt = readReceipt(lab, 'gcloud-fail-1');
    expect(receipt.result).toBe('FAIL');
    expect(receipt.failure).toMatch(/gcloud failed \(exit 1\)/);
  });
});

describe('gcp-repeatable-lab firewall equivalence (split vs grouped) and fail-closed controls', () => {
  function runWithFirewall(runId: string, allowed: unknown, overrides: object = {}) {
    const instanceName = `clawx-lab-${runId}`;
    const rules = happyRules(instanceName);
    rules[4] = {
      match: ['firewall-rules', 'list'],
      stdout: JSON.stringify([{ ...FIREWALL_OK, allowed, ...overrides }]),
    };
    const lab = makeLab(rules);
    const r = run(lab, ['create', '--run-id', runId, '--image', IMG.name, '--receipt-dir', lab.receipts]);
    return { lab, r };
  }
  const firewallCreates = (lab: Lab) =>
    calls(lab).filter((argv) => argv.includes('firewall-rules') && argv.includes('create'));
  const instanceCreates = (lab: Lab) =>
    calls(lab).filter((argv) => argv.includes('instances') && argv.includes('create'));

  it('accepts the actual split per-port representation the real API returns', () => {
    const { lab, r } = runWithFirewall('fw-split-1', [
      { IPProtocol: 'tcp', ports: ['22'] }, { IPProtocol: 'tcp', ports: ['3389'] },
    ]);
    expect(r.status).toBe(0);
    expect(readReceipt(lab, 'fw-split-1').result).toBe('PASS');
    expect(firewallCreates(lab)).toEqual([]); // adopted as-is, never mutated
    expect(instanceCreates(lab)).toHaveLength(1);
  });

  it('accepts the equivalent grouped representation', () => {
    const { lab, r } = runWithFirewall('fw-grouped-1', [
      { IPProtocol: 'tcp', ports: ['22', '3389'] },
    ]);
    expect(r.status).toBe(0);
    expect(readReceipt(lab, 'fw-grouped-1').result).toBe('PASS');
    expect(firewallCreates(lab)).toEqual([]);
  });

  const refusals: Array<[string, string, unknown, RegExp]> = [
    ['missing port (22 only)', 'fw-missing-1',
      [{ IPProtocol: 'tcp', ports: ['22'] }], /allowed tcp ports/],
    ['unrestricted tcp entry (no ports = all ports)', 'fw-allports-1',
      [{ IPProtocol: 'tcp', ports: ['22'] }, { IPProtocol: 'tcp' }], /no port restriction/],
    ['extra tcp port beyond the pinned set', 'fw-extra-1',
      [{ IPProtocol: 'tcp', ports: ['22'] }, { IPProtocol: 'tcp', ports: ['3389', '80'] }],
      /unexpected tcp port '80'/],
    ['port range instead of exact ports', 'fw-range-1',
      [{ IPProtocol: 'tcp', ports: ['22-3389'] }], /unexpected tcp port '22-3389'/],
    ['non-tcp protocol', 'fw-udp-1',
      [{ IPProtocol: 'tcp', ports: ['22', '3389'] }, { IPProtocol: 'udp', ports: ['3389'] }],
      /non-tcp protocol 'udp'/],
    ['empty allowed list', 'fw-empty-1', [], /no allowed rules/],
  ];
  for (const [label, runId, allowed, failureRe] of refusals) {
    it(`refuses drift: ${label}`, () => {
      const { lab, r } = runWithFirewall(runId, allowed);
      expect(r.status).toBe(1);
      const receipt = readReceipt(lab, runId);
      expect(receipt.result).toBe('FAIL');
      expect(receipt.failure).toMatch(/refusing drift/);
      expect(receipt.failure).toMatch(failureRe);
      expect(firewallCreates(lab)).toEqual([]); // refuse, never repair in place
      expect(instanceCreates(lab)).toEqual([]);
    });
  }

  it('still refuses source/target/network drift with correct split ports', () => {
    const drifts: Array<[string, object, RegExp]> = [
      ['fw-src-1', { sourceRanges: ['0.0.0.0/0'] }, /source ranges/],
      ['fw-tag-1', { targetTags: ['some-other-tag'] }, /target tags/],
      ['fw-net-1', { network: 'https://compute/projects/p/global/networks/default' }, /different network/],
    ];
    for (const [runId, overrides, failureRe] of drifts) {
      const { lab, r } = runWithFirewall(runId, FIREWALL_OK.allowed, overrides);
      expect(r.status).toBe(1);
      const receipt = readReceipt(lab, runId);
      expect(receipt.result).toBe('FAIL');
      expect(receipt.failure).toMatch(failureRe);
      expect(instanceCreates(lab)).toEqual([]);
    }
  });
});

describe('gcp-repeatable-lab create success path', () => {
  it('provisions, writes an immutable PASS receipt, and touches nothing else', () => {
    const runId = 'happy-20260908';
    const instanceName = `clawx-lab-${runId}`;
    const lab = makeLab(happyRules(instanceName));
    const r = run(lab, ['create', '--run-id', runId, '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(0);

    const receipt = readReceipt(lab, runId);
    expect(receipt.result).toBe('PASS');
    expect(receipt.instance.id).toBe('4242424242424242424');
    expect(receipt.instance.name).toBe(instanceName);
    expect(receipt.image.readbackId).toBe(IMG.id);
    expect(receipt.created).toEqual({ network: false, subnet: false, firewall: false });
    expect(receipt.startedAt).toBeTruthy();
    expect(receipt.endedAt).toBeTruthy();
    expect(receipt.configSha256).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(lab.receipts, `${runId}.receipt.json`)).mode & 0o222).toBe(0);
    }

    const logged = calls(lab);
    expect(logged[logged.length - 1]).toEqual([
      'compute', 'instances', 'create', instanceName,
      '--project=gen-lang-client-0649986230', '--zone=us-central1-a',
      '--machine-type=n2-standard-8', `--image=${IMG.name}`,
      '--image-project=windows-cloud', '--boot-disk-size=100GB',
      '--boot-disk-type=pd-ssd',
      '--network-interface=subnet=clawx-test-lab-us-central1',
      '--tags=clawx-repeatable-test', '--no-service-account', '--no-scopes',
      '--metadata=sysprep-specialize-script-cmd=googet -noconfirm=true install google-compute-engine-ssh,enable-windows-ssh=TRUE,block-project-ssh-keys=TRUE',
      '--format=json', '--quiet',
    ]);
    // No guessed credentials, no ssh/auth subcommands, no key material flags,
    // no desktop side effects. (Metadata VALUES like block-project-ssh-keys
    // are expected; credential subcommands/flags are not.)
    for (const argv of logged) {
      expect(argv[0]).not.toBe('auth');
      expect(argv.slice(0, 4)).not.toContain('ssh');
      expect(argv.some((a) => a.startsWith('--ssh-key') || a.startsWith('--account')
        || a.startsWith('--access-token') || a.startsWith('--credential'))).toBe(false);
    }
    expect(fs.readdirSync(lab.home)).toEqual([]);

    // The same run-id can never produce a second VM: receipt blocks reuse.
    const again = run(lab, ['create', '--run-id', runId, '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(again.status).toBe(2);
    expect(calls(lab).filter((argv) => argv.includes('instances') && argv.includes('create'))).toHaveLength(1);
  });

  it('creates missing dedicated lab network/subnet/firewall by exact name', () => {
    const runId = 'infra-20260908';
    const instanceName = `clawx-lab-${runId}`;
    const rules: Rule[] = [
      { match: ['images', 'describe'], stdout: JSON.stringify({ name: IMG.name, id: IMG.id }) },
      { match: ['instances', 'list'], stdout: '[]' },
      { match: ['subnets', 'create'], stdout: JSON.stringify([SUBNET_OK]) },
      { match: ['subnets', 'list'], stdout: '[]' },
      { match: ['networks', 'create'], stdout: JSON.stringify([NET_OK]) },
      { match: ['networks', 'list'], stdout: '[]' },
      { match: ['firewall-rules', 'create'], stdout: JSON.stringify([FIREWALL_OK]) },
      { match: ['firewall-rules', 'list'], stdout: '[]' },
      { match: ['instances', 'create'], stdout: JSON.stringify([{ id: '777000777', name: instanceName, status: 'RUNNING' }]) },
    ];
    const lab = makeLab(rules);
    const r = run(lab, ['create', '--run-id', runId, '--image', IMG.name, '--receipt-dir', lab.receipts]);
    expect(r.status).toBe(0);
    const receipt = readReceipt(lab, runId);
    expect(receipt.result).toBe('PASS');
    expect(receipt.created).toEqual({ network: true, subnet: true, firewall: true });
    const flat = calls(lab).map((argv) => argv.join(' '));
    expect(flat.some((c) => c.includes('networks create clawx-test-lab') && c.includes('--subnet-mode=custom'))).toBe(true);
    expect(flat.some((c) => c.includes('subnets create clawx-test-lab-us-central1') && c.includes('--range=10.74.0.0/24'))).toBe(true);
    expect(flat.some((c) => c.includes(`firewall-rules create ${baseline.firewall.name}`)
      && c.includes('--source-ranges=35.235.240.0/20')
      && c.includes('--rules=tcp:22,tcp:3389')
      && c.includes('--target-tags=clawx-repeatable-test'))).toBe(true);
  });
});
