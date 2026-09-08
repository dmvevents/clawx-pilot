# Windows test controller — bootstrap and authenticated probe (CLWX-25)

A small dependency-free Python CLI that provisions ONE dedicated GCP
controller VM inside the existing isolated `clawx-test-lab` network and runs a
bounded, receipted **probe** of durable Windows SSH access from that
controller, using an **attached user-managed service account** (metadata
workload credentials) instead of the Mac operator's personal `gcloud` session.
This removes the observed single point of failure: personal user credentials
and authorized-user ADC expiring with a reauthentication requirement.

- CLI: `windows-pilot/vm-testing/gcp-test-controller.py` (stdlib Python, argv
  subprocess, no shell, no third-party dependencies)
- Example config: `windows-pilot/vm-testing/controller-config.example.json`
  (all placeholders; root supplies the resolved config privately — see
  `controller-root-inputs.json` in the operator worktree, not committed)
- Tests: `tests/unit/gcp-test-controller.test.py`
  (`python3 tests/unit/gcp-test-controller.test.py`, fake `gcloud`/`ssh` on
  PATH plus local IAP REST and metadata-server stubs; 23 behavioral tests)

**Scope of this first delivery.** Bootstrap + probe only. There is
deliberately NO arbitrary job execution, scheduling, reconnection supervision,
delete/reset/stop, or IAM revocation in this CLI. Windows desktop/tenant proof
and installer acceptance remain their own workflows.

## Shape of the deployment

| Item | Value |
|---|---|
| Controller | pinned Linux image (exact name + numeric ID readback), `e2-medium`, 20 GB `pd-balanced`, in `clawx-test-lab`/`clawx-test-lab-us-central1` |
| Ingress | IAP-only (`35.235.240.0/20`) tcp:22 via a NEW controller-tag firewall rule; no other inbound |
| Egress | ephemeral external IP retained — no Cloud NAT exists in us-central1, so removing it removes all outbound Internet |
| Identity | NEW dedicated service account attached with `--scopes=cloud-platform`; effective permissions controlled entirely by IAM |
| IAM | NEW custom role with exactly `compute.instances.get` + `compute.instances.list`, plus per-target `roles/iap.tunnelResourceAccessor` conditioned on `destination.port == 22`. No Editor/Owner/InstanceAdmin, no project metadata writes, no key files |
| SSH keys | `block-project-ssh-keys=TRUE`; the root-supplied operator **public** key is provisioned via instance metadata. Private keys and tokens never enter cloud metadata, plans or receipts |
| Windows guests | no service account attached; root authorizes a dedicated controller SSH public key on the allowlisted guest while preserving prior keys |

### Why the IAP grant uses REST, not a gcloud command

The originally proposed `gcloud iap tcp resources add-iam-policy-binding`
does not exist. File evidence (Cloud SDK 582.0.0,
`lib/surface/iap/tcp/add_iam_policy_binding.py` and
`lib/googlecloudsdk/command_lib/iap/util.py`,
`IAP_TCP_IAM_RESOURCE_TYPE_ENUM = ('cloud-run',)`): the alpha/beta
`gcloud iap tcp add-iam-policy-binding` supports **cloud-run resources only**,
and the official page documents per-VM grants via the Console or the IAP REST
API. The CLI therefore uses the documented
[IAP TCP forwarding](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding)
REST v1 path per target:
`projects/PROJECT_NUMBER/iap_tunnel/zones/ZONE/instances/INSTANCE_ID`
`:getIamPolicy` (requestedPolicyVersion 3) → append the conditioned binding
preserving **all existing bindings and the etag** → `:setIamPolicy` → fresh
`:getIamPolicy` readback. A same-member binding with a different condition is
refused, never modified. The access token stays in memory and is redacted
from any error path. Root confirmed the same finding independently.

Alternatively set `"iamMode": "prerequisite"` and root grants the discovery
role and per-target IAP bindings manually; bootstrap then records that
prerequisite instead of applying IAM, and the probe still fails closed if the
grant is missing.

## Prerequisites

1. Root (sole cloud mutator) runs `plan`/`bootstrap` on a machine with an
   authorized gcloud session; the CLI itself stores no credentials.
2. Resolved config (no placeholders): exact project/number/zone, pinned Linux
   image name+project+numeric ID, existing lab network/subnet, new controller
   /SA/role/firewall names, allowlisted targets with exact numeric instance
   IDs and guest SSH usernames, operator PUBLIC SSH key.
3. Controller guest tools: `gcloud` and OpenSSH client must exist on the
   controller. Inspect the pinned image instead of assuming tools are absent:
   this deployment already had `/usr/bin/gcloud` and `/usr/bin/ssh`. Install
   missing tools through the documented package manager only if needed.
   The probe fails with an explicit status if either tool is absent.
4. Root places the Windows guest **private** key and a pinned known_hosts
   file on the controller privately. The known_hosts entry must use the
   target VM name (the probe pins `HostKeyAlias=<target-name>`), e.g.
   `clawx-lab-auto-d-20260908 ssh-ed25519 AAAA...`.

## Commands

```sh
# Read-only, spawns no subprocess; prints argv + IAP REST grants + blockers.
python3 windows-pilot/vm-testing/gcp-test-controller.py plan \
  --config <resolved-config.json>

# Root-run deployment (the only mutating command).
python3 windows-pilot/vm-testing/gcp-test-controller.py bootstrap \
  --config <resolved-config.json> \
  --run-id ctl-a-20260908 \
  --controller <exact-controller-name> \
  --receipt-dir artifacts/controller-receipts

# Controller-side, after root provisions guest key + known_hosts.
python3 gcp-test-controller.py probe \
  --config <resolved-config.json> \
  --target clawx-lab-auto-d-20260908 \
  --receipt-dir ~/clawx-controller/receipts
```

`bootstrap` fail-closes, in order: config blockers (placeholders, syntax,
non-numeric IDs, unsafe role permissions, non-public key, protected-owner
collisions), `--controller` double-entry mismatch, existing receipt/lock
(run-ids are single-use, no replay), image numeric-ID readback mismatch,
missing/foreign lab network or subnet, target numeric-ID readback mismatch,
any pre-existing SA/role/firewall/controller (conflicts are refused, never
adopted, overwritten or deleted), IAP policy conflict or missing etag, and
readback mismatch of every created resource. A subprocess timeout writes an
`UNCERTAIN` receipt and stops; reconciliation is manual — inspect the stage
receipts and actual cloud state before anything is rerun under a new run-id.

`probe` first verifies the **metadata-attached service account email** equals
the expected controller SA and refuses off-controller or under any other
identity; a scrubbed environment alone is not identity proof. It then runs
all subprocesses with every `CLOUDSDK_*` credential/impersonation/token
override and ADC/agent variable scrubbed and `CLOUDSDK_CONFIG` repointed at a
fresh private empty directory, so the default user gcloud config can never
supply credentials. It takes a durable per-target lock, verifies the target's
numeric instance ID, opens an owned `start-iap-tunnel` process group to guest
:22 (killed only via its verified own process group — pgid must equal the
created child pid, otherwise only the single child is terminated), and
records three checks:

1. `sshBanner` — a real `SSH-` protocol banner through the tunnel.
2. `authenticatedMarker` — plain `ssh` with `-F /dev/null` (no user config),
   `BatchMode`, `StrictHostKeyChecking=yes`, pinned `UserKnownHostsFile`,
   `IdentitiesOnly=yes`, `HostKeyAlias=<target>`, `SSH_AUTH_SOCK` scrubbed,
   and the `--` option terminator placed before the destination so nothing
   leaks into the remote Windows command line; PASS only on native exit 0
   plus the exact marker line.
3. `deniedPortControl` — a tunnel to an unauthorized port. A local listener
   bind or accepted local TCP connect is NOT remote access: the control makes
   a real connection through the tunnel and passes ONLY on an explicit
   permission denial (`BLOCKED_IAM`, 403/PERMISSION_DENIED). Remote protocol
   data is `FAIL_OPEN`; a closed backend port (`4003`) is
   `INCONCLUSIVE_BACKEND` and never a pass — pick a denied port that is open
   on the guest (e.g. 3389).

A definite PASS/FAIL releases the lock. A timeout or unexpected error writes
an `UNCERTAIN` receipt and **keeps the lock**; the same probe is never
replayed automatically. Reconcile manually: confirm no owned
tunnel/ssh processes remain (owned PIDs from the receipt only — never
pattern-kill `gcloud`/`ssh`), read the newest receipt and tunnel log, then
remove `locks/<target>.lock.json` deliberately.

## Remaining durability acceptance

Live bootstrap and the first controller-side authenticated probe now pass
(see dated evidence below). The e2-medium controller bills while RUNNING.
Remaining evidence, owned by root:
- Durability sequence from the runbook: probe after operator-credential
  expiry/renewal, after Mac disconnect/sleep, after controller restart, after
  a disposable guest reboot; overnight soak beside product acceptance; and
  the IAM revocation negative control (root-run — this CLI has no revoke).
- Bounded job execution/state (beyond the probe) is deferred to the next
  delivery; nothing here claims automatic resume of interrupted work.
- IAP's documented ~1h inactivity timeout still applies per tunnel; this
  controller changes the *identity* durability, not network invariants.
  Microsoft/tenant sign-in remains a separate account-holder concern.


## First live deployment — September 8, 2026

Independently reviewed source `5b051f4c` (23 behavioral tests plus two mutation falsifiers) integrated as `2afde150`. Root bootstrap `controller-a-20260908` passed all resource readbacks at19:02:02UTC: controller ID1706114158640883022, dedicated service account, the two discovery permissions, per-auto-d SSH-port IAP condition and isolated controller firewall. The original Windows VM was excluded. Private receipt: `artifacts/ga-fable-20260908/windows-lab/controller-live/bootstrap-controller-a-20260908.receipt.json`.

Operator host-key retrieval returned HTTP 404, including after enabling guest attributes and gracefully stopping/starting only the new controller. Host-key publication through the API remains unproven. Root made one first-trust SSH connection through authenticated IAP to the API-pinned new instance, with a dedicated empty private known_hosts file and `accept-new`; all later operator connections used that recorded key with strict checking. This is recorded first trust, not an API-retrieved host-key proof. No product job or stakeholder state was on the restarted controller. [Google guest-attributes documentation](https://cloud.google.com/compute/docs/metadata/manage-guest-attributes) describes the API channel that did not produce a key here.

The restricted service account cannot write Google guest-agent telemetry to Cloud Logging. The serial log records that denial; it is not an SSH or product failure and no broader IAM role was added merely to silence it. Local private operator/probe receipts remain the evidence source.

At **19:14:42 UTC**, the deployed CLI passed its first real controller-side probe against auto-d (instance ID4908385059495321872): exact target identity, Windows SSH protocol, authenticated marker with native exit 0, and unauthorized port3389 denied by IAP4033. The CLI verified the attached dedicated service account and used a fresh isolated Cloud SDK configuration with personal credential overrides excluded. Reviewed CLI/config transfer hashes and private key permissions also passed. The dedicated guest public key was appended only to auto-d instance metadata with prior entries preserved; the original Windows VM was untouched. Private receipt: `artifacts/ga-fable-20260908/windows-lab/controller-live/controller-first-probe-readback.json`.

This proves independent authenticated access, not a completed job scheduler or long-term durability. Detached operator-SSH disconnect and controller restart checks also pass below; identity renewal, Mac sleep, guest reboot, overnight and IAM revocation acceptance remain separate checks. The product still fails moe.26 Gateway startup under CLWX-135.

At **19:16:55 UTC**, a detached probe finished PASS after its controlling operator SSH session returned and disconnected. At **19:19:32 UTC**, another probe passed after a graceful stop/start of only the new controller, using the same strict host-key pin and retained private configuration. All four checks passed on both runs; unauthorized port3389 remained denied. These are separate observed recovery tests, not simulated credential expiry or overnight proof. Private readbacks: `operator-disconnect-probe-readback.json` and `controller-after-restart-probe-readback.json` in the controller-live evidence directory.
