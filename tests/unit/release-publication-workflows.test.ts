import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const manualWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'package-win-manual.yml');
const releaseWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'release.yml');

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

type Workflow = {
  on: {
    workflow_dispatch: {
      inputs: Record<string, unknown>;
    };
  };
  jobs: Record<string, { steps: WorkflowStep[]; 'runs-on'?: string[] }>;
};

function readWorkflow(filePath: string) {
  const text = readFileSync(filePath, 'utf8');
  return { text, workflow: parse(text) as Workflow };
}

function jobSteps(workflow: Workflow, jobName: string) {
  return workflow.jobs[jobName].steps;
}

function stepIndex(steps: WorkflowStep[], name: string) {
  return steps.findIndex((step) => step.name === name);
}

describe('release publication workflow guards (CLWX-106)', () => {
  it('produces the exact artifact consumed by publication only after strict acceptance and revalidation', () => {
    const { workflow, text } = readWorkflow(path.join(process.cwd(), '.github/workflows/release-evidence-manual.yml'));
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.jobs['collect-evidence']['runs-on']).toEqual(['self-hosted', 'macOS', 'clawx-acceptance']);
    expect(workflow.on.workflow_dispatch.inputs.authorizedSendProof).toMatchObject({ default: false });
    const steps = jobSteps(workflow, 'collect-evidence');
    const gate = steps.find((step) => step.name === 'Run strict acceptance with measured Windows evidence');
    expect(gate?.env).toMatchObject({ GA_GATE_RELEASE: '1', GA_GATE_STATIC: '0', GA_GATE_E2E: '1', GA_GATE_INSTALLED_EVIDENCE: '${{ inputs.installedEvidenceDir }}' });
    expect(gate?.run).toContain('node scripts/ga-gate.mjs --release');
    expect(gate?.run).toContain('node scripts/release-evidence.mjs check');
    expect(gate?.run).not.toContain('|| true');
    const upload = steps.find((step) => step.name === 'Retain complete evidence for release review');
    const consumer = jobSteps(readWorkflow(manualWorkflowPath).workflow, 'publish-existing-windows-run').find((step) => step.name === 'Download GA release evidence');
    expect(upload?.with?.name).toBe(consumer?.with?.name);
    expect(steps.indexOf(upload!)).toBeGreaterThan(steps.indexOf(gate!));
    expect(text).not.toContain('gh release');
  });
  it('manual Windows publication requires checked evidence before any GitHub release mutation', () => {
    const { text, workflow } = readWorkflow(manualWorkflowPath);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.evidenceRunId).toMatchObject({ required: false, default: '' });

    const steps = jobSteps(workflow, 'publish-existing-windows-run');
    const requireInputs = stepIndex(steps, 'Require publication inputs');
    const proofDownload = stepIndex(steps, 'Download GA release evidence');
    const validate = stepIndex(steps, 'Validate release evidence and tag');
    const publish = stepIndex(steps, 'Publish checked Windows artifact to release');
    expect(requireInputs).toBeGreaterThan(-1);
    expect(proofDownload).toBeGreaterThan(requireInputs);
    expect(validate).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(validate);
    expect(text.indexOf('node scripts/release-evidence.mjs check')).toBeLessThan(text.indexOf('gh release upload'));
    expect(text.indexOf('node scripts/release-evidence.mjs check')).toBeLessThan(text.indexOf('gh release edit'));
    expect(text).toContain('--tag "$RELEASE_TAG"');
    expect(text).toContain('publishReleaseTag must be exactly v${VERSION}');
    expect(text).toContain('evidenceRunId is required when publishFromRunId is set.');
  });

  it('manual Windows publication downloads proof/artifacts outside the repo and publishes only one checked exe plus current docs', () => {
    const { text, workflow } = readWorkflow(manualWorkflowPath);
    const steps = jobSteps(workflow, 'publish-existing-windows-run');
    const checkout = steps.find((step) => step.name === 'Checkout release source');
    expect(checkout?.with).toMatchObject({ ref: '${{ inputs.ref || github.ref }}', 'fetch-depth': 0 });

    const proofDownload = steps.find((step) => step.name === 'Download GA release evidence');
    expect(proofDownload?.with).toMatchObject({
      'run-id': '${{ inputs.evidenceRunId }}',
      path: '${{ runner.temp }}/release-proof',
      name: 'ga-release-evidence',
    });
    const artifactDownload = steps.find((step) => step.name === 'Download Windows artifacts from completed run');
    expect(artifactDownload?.with).toMatchObject({
      'run-id': '${{ inputs.publishFromRunId }}',
      path: '${{ runner.temp }}/release-artifacts',
      pattern: 'windows-*',
    });

    expect(text).toContain('find "$RELEASE_ARTIFACTS" -type f -name \'*.exe\'');
    expect(text).toContain('Expected exactly one checked Windows .exe');
    expect(text).toContain('docs/CURRENT_WINDOWS_RC.md');
    expect(text).toContain('docs/GA_RELEASE_EVIDENCE_MANIFEST.md');
    expect(text).toContain('docs/COMPLETION_PLAN.md');
    expect(text).not.toContain('*.blockmap\'');
    expect(text).not.toContain('*.yml\'');
    expect(text).not.toContain('--clobber');
    expect(text).not.toContain('--notes-file windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_RELEASE_NOTES.md');
  });

  it('manual Windows package job defaults to keyless-public and refuses contradictory credential seed requirements', () => {
    const { workflow } = readWorkflow(manualWorkflowPath);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.cloudGatewaySeedProfile).toMatchObject({
      required: true,
      type: 'choice',
      default: 'keyless-public',
      options: ['keyless-public', 'seeded-private'],
    });
    expect(inputs.requireCloudGatewaySeed).toMatchObject({ default: false });

    const steps = jobSteps(workflow, 'package-windows');
    const resolve = stepIndex(steps, 'Resolve hosted build profile');
    const cloud = stepIndex(steps, 'Prepare cloud gateway seed');
    const azure = stepIndex(steps, 'Prepare Azure Speech seed');
    const build = stepIndex(steps, 'Build Windows package (no publish)');
    expect(resolve).toBeGreaterThan(-1);
    expect(cloud).toBeGreaterThan(resolve);
    expect(azure).toBeGreaterThan(resolve);
    expect(build).toBeGreaterThan(resolve);
    expect(steps[resolve]?.run).toContain('seeded-private hosted Windows builds are refused for public repositories.');
    expect(steps[resolve]?.run).toContain('requireCloudGatewaySeed=true contradicts cloudGatewaySeedProfile=keyless-public.');
    expect(steps[resolve]?.run).toContain('requireAzureSpeechSeed=true contradicts cloudGatewaySeedProfile=keyless-public.');
    const resolveRun = steps[resolve]?.run ?? '';
    expect(resolveRun).toContain('https://api.github.com/repos/$env:GITHUB_REPOSITORY');
    expect(resolveRun).toContain("if ($profile -eq 'seeded-private' -and -not $apiRepositoryPrivate)");
    expect(resolveRun).toContain('GitHub repository visibility API disagrees with workflow event payload.');
    expect(resolve).toBeLessThan(cloud);
  });

  it('keyless-public hosted builds do not inject credential-bearing seeds and verify staged seed absence before upload', () => {
    const { text, workflow } = readWorkflow(manualWorkflowPath);
    const steps = jobSteps(workflow, 'package-windows');
    const cloud = steps[stepIndex(steps, 'Prepare cloud gateway seed')];
    const azure = steps[stepIndex(steps, 'Prepare Azure Speech seed')];
    const record = steps[stepIndex(steps, 'Record hosted build profile provenance')];
    const verify = stepIndex(steps, 'Verify keyless staged package seeds');
    const upload = stepIndex(steps, 'Upload Windows Installer (x64)');

    expect(cloud?.if).toBe("${{ inputs.cloudGatewaySeedProfile == 'seeded-private' }}");
    expect(azure?.if).toBe("${{ inputs.cloudGatewaySeedProfile == 'seeded-private' }}");
    expect(cloud?.env).toHaveProperty('CLOUD_GATEWAY_CONFIG_JSON');
    expect(azure?.env).toHaveProperty('AZURE_SPEECH_KEY');
    expect(record?.run).toContain('cloudGatewaySeedIncluded');
    expect(record?.run).toContain('azureSpeechSeedIncluded');
    expect(record?.run).toContain('credentialSeedIncluded');
    expect(record?.run).toContain('keyless-public build profile cannot include cloud gateway or Azure Speech credential-bearing seeds.');
    expect(verify).toBeGreaterThan(stepIndex(steps, 'Build Windows package (no publish)'));
    expect(upload).toBeGreaterThan(verify);
    expect(steps[verify]?.run).toContain('keyless-public staged package contains credential-bearing seed files');
    expect(text).toContain('.tmp/release-build-profile.json');
  });

  it('publish-existing Windows release requires selected build provenance to be keyless and source-bound before upload', () => {
    const { text, workflow } = readWorkflow(manualWorkflowPath);
    const steps = jobSteps(workflow, 'publish-existing-windows-run');
    const artifacts = stepIndex(steps, 'Download Windows artifacts from completed run');
    const provenance = stepIndex(steps, 'Download build provenance from completed run');
    const validate = stepIndex(steps, 'Validate release evidence and tag');
    const publish = stepIndex(steps, 'Publish checked Windows artifact to release');

    expect(provenance).toBeGreaterThan(artifacts);
    expect(validate).toBeGreaterThan(provenance);
    expect(publish).toBeGreaterThan(validate);
    expect(steps[provenance]?.with).toMatchObject({
      'run-id': '${{ inputs.publishFromRunId }}',
      path: '${{ runner.temp }}/build-provenance',
      name: 'build-provenance',
    });
    expect(text).toContain('node scripts/release-build-profile.mjs check-public-release');
    expect(text).toContain('--profile "$BUILD_PROVENANCE/.tmp/release-build-profile.json"');
    expect(text).toContain('--source "$BUILD_PROVENANCE/.release-build-source.json"');
    expect(text).toContain('--receipt "$BUILD_PROVENANCE/.tmp/release-build-output.json"');
    expect(text).toContain('--manifest "$RELEASE_PROOF/manifest.json"');
    expect(text.indexOf('release-build-profile.json')).toBeLessThan(text.indexOf('gh release upload'));
  });

  it('manual Windows package job pins .NET before building the net48 ASR helper', () => {
    const { workflow } = readWorkflow(manualWorkflowPath);
    const steps = jobSteps(workflow, 'package-windows');
    const setupNode = stepIndex(steps, 'Setup Node.js');
    const setupDotnet = stepIndex(steps, 'Setup .NET SDK for Windows ASR helper');
    const verifyDotnet = stepIndex(steps, 'Verify .NET SDK');
    const prepWin = stepIndex(steps, 'Build Windows package (no publish)');
    const dotnetStep = steps[setupDotnet];
    const verifyStep = steps[verifyDotnet];

    expect(setupDotnet).toBeGreaterThan(setupNode);
    expect(verifyDotnet).toBeGreaterThan(setupDotnet);
    expect(prepWin).toBeGreaterThan(verifyDotnet);
    expect(dotnetStep).toMatchObject({
      uses: 'actions/setup-dotnet@v5',
      with: { 'dotnet-version': '8.0.424' },
    });
    expect(verifyStep?.run).toContain('dotnet --info');
  });

  it('manual Windows package job uploads full build provenance for later evidence checks', () => {
    const { text, workflow } = readWorkflow(manualWorkflowPath);
    const steps = jobSteps(workflow, 'package-windows');
    const build = stepIndex(steps, 'Build Windows package (no publish)');
    const provenance = stepIndex(steps, 'Upload build provenance manifest');
    const provenanceStep = steps[provenance];

    expect(provenance).toBeGreaterThan(build);
    expect(text).toContain('name: build-provenance');
    expect(provenanceStep?.with?.path).toContain('.release-build-source.json');
    expect(provenanceStep?.with?.path).toContain('.tmp/release-build-output.json');
    expect(provenanceStep?.with?.path).toContain('.tmp/release-build-profile.json');
    expect(provenanceStep?.with?.path).toContain('docs/release-manifests/*.json');
  });

  it('generic automatic release blocks Ministry versions before any matrix build', () => {
    const { text, workflow } = readWorkflow(releaseWorkflowPath);
    const steps = jobSteps(workflow, 'validate-release');
    const policy = stepIndex(steps, 'Block automatic Ministry release path');
    const assertTag = stepIndex(steps, 'Assert tag matches package.json');
    expect(policy).toBeGreaterThan(-1);
    expect(assertTag).toBeGreaterThan(policy);
    expect(text.indexOf('node scripts/release-evidence.mjs check-automatic-policy')).toBeLessThan(text.indexOf('pnpm run package:mac'));
    expect(text.indexOf('node scripts/release-evidence.mjs check-automatic-policy')).toBeLessThan(text.indexOf('pnpm run package:win'));
    expect(text.indexOf('node scripts/release-evidence.mjs check-automatic-policy')).toBeLessThan(text.indexOf('softprops/action-gh-release'));
  });
});
