#!/usr/bin/env python3
"""Durable Windows test-controller bootstrap + authenticated probe (CLWX-25).

Minimal first delivery: provision ONE small dedicated GCP controller VM in the
existing isolated `clawx-test-lab` network, carrying a dedicated user-managed
service account (attached workload credentials, no JSON keys, no personal Mac
user credentials), and run a bounded controller-side PROBE against allowlisted
Windows lab targets over an owned IAP tunnel: real SSH banner, authenticated
marker over strict known-host SSH, and a denied-port negative control.

Deliberately NOT in this version: arbitrary job execution/scheduling, resume,
reconnection supervision, delete/reset/stop, or any IAM revocation. Uncertain
probe outcomes keep the per-target lock; reconciliation is manual and
documented in docs/testing/WINDOWS_TEST_CONTROLLER.md.

Commands:
  plan       Pure. No subprocess, no network. Prints exact gcloud argv, the
             IAP REST grant description and blockers.
  bootstrap  Mutating (root-run, root credentials). Fail-closed preflight,
             creates ONLY new named scoped resources, reads back each one.
  probe      Controller-side. Uses attached-SA metadata credentials with a
             cleaned environment (personal CLOUDSDK_CONFIG/ADC vars stripped).

IAP per-target grant uses the documented IAP REST v1 getIamPolicy/setIamPolicy
with requestedPolicyVersion 3, preserved etag/bindings and a fresh readback
(https://docs.cloud.google.com/iap/docs/using-tcp-forwarding). The gcloud
`iap tcp add-iam-policy-binding` surface in Cloud SDK 582.0.0 supports only
--resource-type=cloud-run (file evidence:
lib/googlecloudsdk/command_lib/iap/util.py IAP_TCP_IAM_RESOURCE_TYPE_ENUM),
so no gcloud binding command is guessed here.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

OFFICIAL_IAP_API_BASE = "https://iap.googleapis.com/v1"
IAP_ROLE = "roles/iap.tunnelResourceAccessor"
IAP_CONDITION_EXPRESSION = "destination.port == 22"
IAP_CONDITION_TITLE = "clawx-controller-ssh-port22"
ALLOWED_DISCOVERY_PERMISSIONS = ("compute.instances.get", "compute.instances.list")
PINNED_MACHINE = {"machineType": "e2-medium", "bootDiskSizeGb": 20,
                  "bootDiskType": "pd-balanced"}
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{2,60}$")
SA_ID_RE = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
ROLE_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_.]{2,63}$")
USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
PUBKEY_RE = re.compile(
    r"^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/=]+( [^\s,][^,\n]*)?$")
NUMERIC_RE = re.compile(r"^[0-9]{5,25}$")
# R1: controller-side commands must use ONLY the attached service account.
# Every CLOUDSDK_* variable (credential/impersonation/token/config overrides)
# is scrubbed, CLOUDSDK_CONFIG is repointed at a FRESH private empty directory
# (so the default user gcloud config is never consulted), and ADC/agent
# variables are removed.
STRIPPED_ENV_EXACT = ("GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_OAUTH_ACCESS_TOKEN",
                      "GOOGLE_GHA_CREDS_PATH", "GOOGLE_IMPERSONATE_SERVICE_ACCOUNT",
                      "SSH_AUTH_SOCK")
METADATA_BASE = "http://metadata.google.internal"
REQUIRED_KEYS = ("project", "projectNumber", "region", "zone", "network",
                 "subnet", "iapRange", "controller", "serviceAccount",
                 "discoveryRole", "iamMode", "targets", "probe",
                 "protectedInstances")


class ControllerError(Exception):
    """Fail-closed refusal; never converted into a pass."""


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def redact(text, extra_secrets=()):
    """Strip anything token-shaped before text can reach receipts/stdout."""
    out = str(text)
    for secret in extra_secrets:
        if secret:
            out = out.replace(secret, "[REDACTED]")
    out = re.sub(r"ya29\.[A-Za-z0-9._\-]+", "[REDACTED]", out)
    out = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", out)
    return out[:500]


def load_config(path):
    with open(path, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    missing = [k for k in REQUIRED_KEYS if k not in cfg]
    if missing:
        raise ControllerError(f"config {path} is missing required keys: {missing}")
    return cfg


def find_placeholders(node, at="config"):
    hits = []
    if isinstance(node, dict):
        for key, value in node.items():
            if not str(key).startswith("_"):  # _note commentary is not config
                hits += find_placeholders(value, f"{at}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            hits += find_placeholders(value, f"{at}[{i}]")
    elif isinstance(node, str) and "PLACEHOLDER" in node.upper():
        hits.append(at)
    return hits


def sa_email(cfg):
    return f"{cfg['serviceAccount']['id']}@{cfg['project']}.iam.gserviceaccount.com"


def config_blockers(cfg):
    b = [f"{spot} is a placeholder; root must supply the resolved value"
         for spot in find_placeholders(cfg)]
    ctrl = cfg["controller"]
    for label, value, rx in (
            ("controller.name", ctrl.get("name", ""), NAME_RE),
            ("controller.tag", ctrl.get("tag", ""), NAME_RE),
            ("controller.firewallName", ctrl.get("firewallName", ""), NAME_RE),
            ("network", cfg["network"], NAME_RE),
            ("subnet", cfg["subnet"], NAME_RE),
            ("serviceAccount.id", cfg["serviceAccount"].get("id", ""), SA_ID_RE),
            ("discoveryRole.id", cfg["discoveryRole"].get("id", ""), ROLE_ID_RE),
            ("controller.operatorUsername", ctrl.get("operatorUsername", ""), USER_RE)):
        if not rx.match(str(value)):
            b.append(f"{label} {value!r} fails its required syntax")
    for key, want in PINNED_MACHINE.items():
        if ctrl.get(key) != want:
            b.append(f"controller.{key} must be exactly {want!r} (auditable pin)")
    image = ctrl.get("image", {})
    if not NUMERIC_RE.match(str(image.get("id", ""))):
        b.append("controller.image.id must be the exact numeric image ID")
    key = str(ctrl.get("operatorSshPublicKey", ""))
    if "PRIVATE" in key.upper() or not PUBKEY_RE.match(key):
        b.append("controller.operatorSshPublicKey must be a single OpenSSH "
                 "PUBLIC key line (never a private key)")
    perms = tuple(cfg["discoveryRole"].get("permissions", []))
    if sorted(perms) != sorted(ALLOWED_DISCOVERY_PERMISSIONS):
        b.append("discoveryRole.permissions must be exactly "
                 f"{list(ALLOWED_DISCOVERY_PERMISSIONS)}; got {list(perms)}")
    if cfg["iamMode"] not in ("apply", "prerequisite"):
        b.append("iamMode must be 'apply' or 'prerequisite'")
    if not cfg["targets"]:
        b.append("targets must list at least one allowlisted Windows VM")
    protected = [str(p) for p in cfg["protectedInstances"] if p]
    for i, tgt in enumerate(cfg["targets"]):
        if not NAME_RE.match(str(tgt.get("name", ""))):
            b.append(f"targets[{i}].name fails required syntax")
        if not NUMERIC_RE.match(str(tgt.get("instanceId", ""))):
            b.append(f"targets[{i}].instanceId must be the exact numeric VM ID")
        if not USER_RE.match(str(tgt.get("sshUsername", ""))):
            b.append(f"targets[{i}].sshUsername fails required syntax")
        if not NAME_RE.match(str(tgt.get("zone", ""))):
            b.append(f"targets[{i}].zone fails required syntax")
        for p in protected:
            if p in str(tgt.get("name", "")):
                b.append(f"targets[{i}] collides with protected owner instance "
                         f"{p!r}; automation never targets it")
    for p in protected:
        if p in ctrl.get("name", ""):
            b.append(f"controller.name collides with protected instance {p!r}")
    probe = cfg["probe"]
    port = probe.get("deniedControlPort")
    if not isinstance(port, int) or not 1 <= port <= 65535 or port == 22:
        b.append("probe.deniedControlPort must be a port other than 22 (the "
                 "only IAP-authorized port)")
    base = cfg.get("iapApiBase", OFFICIAL_IAP_API_BASE)
    if base != OFFICIAL_IAP_API_BASE and \
            os.environ.get("CLAWX_CONTROLLER_TEST_IAP_BASE") != base:
        b.append("iapApiBase must be the official IAP API base (test override "
                 "requires CLAWX_CONTROLLER_TEST_IAP_BASE to match exactly)")
    return b


def build_argv(cfg, ssh_keys_file="<generated-at-bootstrap>"):
    ctrl, image, project = cfg["controller"], cfg["controller"]["image"], cfg["project"]
    email, role = sa_email(cfg), cfg["discoveryRole"]["id"]
    argv = {
        "imageDescribe": ["gcloud", "compute", "images", "describe",
                          image["name"], f"--project={image['project']}",
                          "--format=json"],
        "networkDescribe": ["gcloud", "compute", "networks", "describe",
                            cfg["network"], f"--project={project}", "--format=json"],
        "subnetDescribe": ["gcloud", "compute", "networks", "subnets", "describe",
                           cfg["subnet"], f"--project={project}",
                           f"--region={cfg['region']}", "--format=json"],
        "saList": ["gcloud", "iam", "service-accounts", "list",
                   f"--project={project}", f"--filter=email={email}", "--format=json"],
        "roleDescribe": ["gcloud", "iam", "roles", "describe", role,
                         f"--project={project}", "--format=json"],
        "firewallList": ["gcloud", "compute", "firewall-rules", "list",
                         f"--project={project}",
                         f"--filter=name={ctrl['firewallName']}", "--format=json"],
        "controllerList": ["gcloud", "compute", "instances", "list",
                           f"--project={project}", f"--filter=name={ctrl['name']}",
                           f"--zones={cfg['zone']}", "--format=json"],
        "saCreate": ["gcloud", "iam", "service-accounts", "create",
                     cfg["serviceAccount"]["id"], f"--project={project}",
                     f"--display-name={cfg['serviceAccount'].get('displayName', 'ClawX test controller')}",
                     "--format=json"],
        "saDescribe": ["gcloud", "iam", "service-accounts", "describe", email,
                       f"--project={project}", "--format=json"],
        "roleCreate": ["gcloud", "iam", "roles", "create", role,
                       f"--project={project}", "--title=ClawX lab instance discovery",
                       "--permissions=" + ",".join(ALLOWED_DISCOVERY_PERMISSIONS),
                       "--stage=GA", "--format=json"],
        "roleBind": ["gcloud", "projects", "add-iam-policy-binding", project,
                     f"--member=serviceAccount:{email}",
                     f"--role=projects/{project}/roles/{role}",
                     "--condition=None", "--format=json"],
        "firewallCreate": ["gcloud", "compute", "firewall-rules", "create",
                           ctrl["firewallName"], f"--project={project}",
                           f"--network={cfg['network']}", "--direction=INGRESS",
                           "--action=ALLOW", "--rules=tcp:22",
                           f"--source-ranges={cfg['iapRange']}",
                           f"--target-tags={ctrl['tag']}", "--format=json", "--quiet"],
        "controllerCreate": ["gcloud", "compute", "instances", "create",
                             ctrl["name"], f"--project={project}",
                             f"--zone={cfg['zone']}",
                             f"--machine-type={ctrl['machineType']}",
                             f"--image={image['name']}",
                             f"--image-project={image['project']}",
                             f"--boot-disk-size={ctrl['bootDiskSizeGb']}GB",
                             f"--boot-disk-type={ctrl['bootDiskType']}",
                             f"--network-interface=subnet={cfg['subnet']}",
                             f"--tags={ctrl['tag']}",
                             f"--service-account={email}", "--scopes=cloud-platform",
                             "--metadata=block-project-ssh-keys=TRUE",
                             f"--metadata-from-file=ssh-keys={ssh_keys_file}",
                             "--format=json", "--quiet"],
    }
    for i, tgt in enumerate(cfg["targets"]):
        argv[f"target{i}Describe"] = [
            "gcloud", "compute", "instances", "describe", tgt["name"],
            f"--project={project}", f"--zone={tgt['zone']}", "--format=json"]
    return argv


def iap_resource_url(cfg, tgt):
    base = cfg.get("iapApiBase", OFFICIAL_IAP_API_BASE)
    return (f"{base}/projects/{cfg['projectNumber']}/iap_tunnel/"
            f"zones/{tgt['zone']}/instances/{tgt['instanceId']}")


def resolve_gcloud(env=None):
    path = shutil.which("gcloud", path=(env or os.environ).get("PATH"))
    if not path:
        raise ControllerError("gcloud not found on PATH; refusing to guess")
    if path.lower().endswith((".cmd", ".bat")):
        return ["cmd.exe", "/c", path]
    return [path]


def gcloud_json(prefix, argv, env=None, timeout=300):
    proc = subprocess.run(prefix + argv[1:], capture_output=True, text=True,
                          timeout=timeout, env=env)  # argv exec, never shell
    if proc.returncode != 0:
        raise ControllerError(
            f"gcloud failed (exit {proc.returncode}): {' '.join(argv[:6])} ...\n"
            + redact(proc.stderr.strip()))
    if not proc.stdout.strip():
        return None
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ControllerError("gcloud returned non-JSON stdout for "
                              + " ".join(argv[:5])) from exc


def access_token(prefix, env=None):
    proc = subprocess.run(prefix + ["auth", "print-access-token"],
                          capture_output=True, text=True, timeout=120, env=env)
    if proc.returncode != 0 or not proc.stdout.strip():
        raise ControllerError("could not obtain an access token: "
                              + redact(proc.stderr.strip()))
    return proc.stdout.strip()


def iap_http(url, token, body):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise ControllerError(
            f"IAP API HTTP {exc.code} on {url.rsplit(':', 1)[-1]}: "
            + redact(detail, extra_secrets=(token,))) from exc
    except urllib.error.URLError as exc:
        raise ControllerError(f"IAP API unreachable: {redact(exc.reason)}") from exc


def iap_grant(cfg, tgt, token):
    """Documented IAP REST v1 read-modify-write with etag + fresh readback."""
    url, member = iap_resource_url(cfg, tgt), f"serviceAccount:{sa_email(cfg)}"
    policy = iap_http(url + ":getIamPolicy", token,
                      {"options": {"requestedPolicyVersion": 3}})
    bindings = policy.get("bindings", [])
    for binding in bindings:
        if binding.get("role") == IAP_ROLE and member in binding.get("members", []):
            cond = binding.get("condition") or {}
            if cond.get("expression") == IAP_CONDITION_EXPRESSION:
                return {"alreadyPresent": True, "resource": url}
            raise ControllerError(
                f"conflicting existing IAP binding for {member} on "
                f"{tgt['name']} (condition {cond.get('expression')!r}); "
                "refusing to modify or replace it")
    if not policy.get("etag"):
        raise ControllerError("IAP getIamPolicy returned no etag; refusing a "
                              "blind concurrent policy overwrite")
    new_policy = dict(policy)  # preserve auditConfigs/etag and any other field
    new_policy["bindings"] = bindings + [{
        "role": IAP_ROLE, "members": [member],
        "condition": {"title": IAP_CONDITION_TITLE,
                      "expression": IAP_CONDITION_EXPRESSION}}]
    new_policy["version"] = 3
    iap_http(url + ":setIamPolicy", token, {"policy": new_policy})
    readback = iap_http(url + ":getIamPolicy", token,
                        {"options": {"requestedPolicyVersion": 3}})
    for binding in readback.get("bindings", []):
        if (binding.get("role") == IAP_ROLE
                and member in binding.get("members", [])
                and (binding.get("condition") or {}).get("expression")
                == IAP_CONDITION_EXPRESSION):
            return {"alreadyPresent": False, "resource": url,
                    "readbackEtag": readback.get("etag")}
    raise ControllerError("IAP setIamPolicy readback does not show the new "
                          "binding; treat this grant as uncertain")


def base_record(args, cfg):
    return {"schema": "clawx-test-controller/1",
            "cliPath": os.path.abspath(__file__),
            "cliSha256": sha256_file(__file__),
            "configPath": os.path.abspath(args.config),
            "configSha256": sha256_file(args.config)}


def write_receipt(path, payload):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o444)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    os.chmod(path, 0o444)


def take_lock(path, extra):
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise ControllerError(
            f"refusing: lock already exists at {path}. A prior operation is "
            "in flight or ended uncertain. Reconcile manually: confirm no "
            "owned tunnel/ssh processes remain and inspect the newest receipt, "
            "then remove the lock deliberately. This CLI never takes over or "
            "replays an uncertain operation.")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump({"pid": os.getpid(), "host": socket.gethostname(),
                   "startedAt": utc_now(), **extra}, fh)


def cmd_plan(args):
    cfg = load_config(args.config)
    plan = base_record(args, cfg)
    plan.update({
        "command": "plan", "mutation": False,
        "blockers": config_blockers(cfg),
        "argv": build_argv(cfg),
        "iapGrants": [{"resource": iap_resource_url(cfg, t),
                       "role": IAP_ROLE, "member": f"serviceAccount:{sa_email(cfg)}",
                       "condition": IAP_CONDITION_EXPRESSION,
                       "mechanism": "IAP REST v1 getIamPolicy/setIamPolicy, "
                                    "requestedPolicyVersion 3, etag preserved"}
                      for t in cfg["targets"]],
        "iamMode": cfg["iamMode"],
        "note": ("plan spawned no subprocess. bootstrap creates ONLY the new "
                 "named SA/role/binding/firewall/controller listed here; the "
                 "lab network/subnet must already exist and are never mutated."),
    })
    print(json.dumps(plan, indent=2))
    return 2 if plan["blockers"] else 0


def stage(receipt, name, fn):
    entry = {"stage": name, "startedAt": utc_now(), "outcome": "FAIL"}
    receipt["stages"].append(entry)
    result = fn()
    entry["outcome"] = "OK"
    entry["endedAt"] = utc_now()
    if result is not None:
        entry["readback"] = result
    return result


def cmd_bootstrap(args):
    cfg = load_config(args.config)
    blockers = config_blockers(cfg)
    if blockers:
        raise ControllerError("refusing bootstrap: " + "; ".join(blockers))
    ctrl, email = cfg["controller"], sa_email(cfg)
    if args.controller != ctrl["name"]:
        raise ControllerError(
            f"--controller {args.controller!r} does not exactly match config "
            f"controller.name {ctrl['name']!r} (double-entry confirmation)")
    os.makedirs(args.receipt_dir, exist_ok=True)
    receipt_path = os.path.join(args.receipt_dir, f"bootstrap-{args.run_id}.receipt.json")
    if os.path.exists(receipt_path):
        raise ControllerError(f"refusing: receipt already exists at "
                              f"{receipt_path}; run-ids are single-use")
    if not re.match(r"^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$", args.run_id):
        raise ControllerError("invalid --run-id (4-40 chars of [a-z0-9-])")
    take_lock(os.path.join(args.receipt_dir, f"bootstrap-{args.run_id}.lock.json"),
              {"runId": args.run_id, "controller": ctrl["name"]})
    receipt = base_record(args, cfg)
    receipt.update({"command": "bootstrap", "runId": args.run_id,
                    "controller": ctrl["name"], "startedAt": utc_now(),
                    "iamMode": cfg["iamMode"], "stages": [], "result": "FAIL",
                    "failure": None})
    ssh_keys_path = os.path.join(args.receipt_dir, f"{args.run_id}.ssh-keys.metadata")
    argv = build_argv(cfg, ssh_keys_path)
    try:
        prefix = resolve_gcloud()

        def preflight():
            image = gcloud_json(prefix, argv["imageDescribe"]) or {}
            pin = ctrl["image"]
            if (str(image.get("id")) != str(pin["id"])
                    or image.get("name") != pin["name"]):
                raise ControllerError(
                    "refusing: image readback mismatch — config pins "
                    f"{pin['name']}/{pin['id']}, gcloud returned "
                    f"{image.get('name')}/{image.get('id')}")
            network = gcloud_json(prefix, argv["networkDescribe"]) or {}
            if network.get("autoCreateSubnetworks") is not False:
                raise ControllerError("refusing: lab network is missing or not "
                                      "custom-mode; this CLI never creates it")
            subnet = gcloud_json(prefix, argv["subnetDescribe"]) or {}
            if not str(subnet.get("network", "")).endswith("/" + cfg["network"]):
                raise ControllerError("refusing: lab subnet is missing or on a "
                                      "different network")
            targets = []
            for i, tgt in enumerate(cfg["targets"]):
                got = gcloud_json(prefix, argv[f"target{i}Describe"]) or {}
                if str(got.get("id")) != str(tgt["instanceId"]):
                    raise ControllerError(
                        f"refusing: target {tgt['name']} numeric ID readback "
                        f"{got.get('id')!r} != allowlisted {tgt['instanceId']!r}")
                targets.append({"name": tgt["name"], "id": str(got.get("id")),
                                "status": got.get("status")})
            return {"image": {"name": image.get("name"), "id": str(image.get("id"))},
                    "targets": targets}

        def conflicts():
            if gcloud_json(prefix, argv["saList"]) or []:
                raise ControllerError(f"refusing: service account {email} "
                                      "already exists; bootstrap creates only "
                                      "NEW resources — reconcile deliberately")
            if gcloud_json(prefix, argv["firewallList"]) or []:
                raise ControllerError(f"refusing: firewall "
                                      f"{ctrl['firewallName']} already exists")
            if gcloud_json(prefix, argv["controllerList"]) or []:
                raise ControllerError(f"refusing: instance {ctrl['name']} "
                                      "already exists; never adopted or replaced")
            if cfg["iamMode"] == "apply":
                probe = subprocess.run(prefix + argv["roleDescribe"][1:],
                                       capture_output=True, text=True, timeout=300)
                if probe.returncode == 0:
                    raise ControllerError(
                        f"refusing: custom role {cfg['discoveryRole']['id']} "
                        "already exists; bootstrap creates only NEW resources")
                if not re.search(r"NOT_FOUND|does not exist|not found",
                                 probe.stderr, re.I):
                    raise ControllerError("role existence check failed "
                                          "uncertain: " + redact(probe.stderr))
            return None

        stage(receipt, "preflight", preflight)
        stage(receipt, "conflicts", conflicts)

        def create_sa():
            gcloud_json(prefix, argv["saCreate"])
            back = gcloud_json(prefix, argv["saDescribe"]) or {}
            if back.get("email") != email or back.get("disabled"):
                raise ControllerError("service-account readback mismatch")
            return {"email": back.get("email"), "uniqueId": back.get("uniqueId")}
        stage(receipt, "serviceAccount", create_sa)

        if cfg["iamMode"] == "apply":
            def create_role():
                gcloud_json(prefix, argv["roleCreate"])
                back = gcloud_json(prefix, argv["roleDescribe"]) or {}
                got = sorted(back.get("includedPermissions", []))
                if got != sorted(ALLOWED_DISCOVERY_PERMISSIONS):
                    raise ControllerError(
                        f"custom role readback has permissions {got}; expected "
                        f"exactly {sorted(ALLOWED_DISCOVERY_PERMISSIONS)}")
                return {"name": back.get("name"), "permissions": got}
            stage(receipt, "discoveryRole", create_role)

            def bind_role():
                policy = gcloud_json(prefix, argv["roleBind"]) or {}
                want = f"projects/{cfg['project']}/roles/{cfg['discoveryRole']['id']}"
                for binding in policy.get("bindings", []):
                    if binding.get("role") == want and \
                            f"serviceAccount:{email}" in binding.get("members", []):
                        return {"role": want, "member": f"serviceAccount:{email}"}
                raise ControllerError("discovery role binding not present in "
                                      "returned policy; not claiming success")
            stage(receipt, "discoveryBinding", bind_role)

            def grant_iap():
                token = access_token(prefix)
                return [dict(iap_grant(cfg, tgt, token), target=tgt["name"])
                        for tgt in cfg["targets"]]
            stage(receipt, "iapTunnelBindings", grant_iap)
        else:
            receipt["stages"].append({
                "stage": "iamPrerequisite", "outcome": "PREREQUISITE",
                "note": ("iamMode=prerequisite: root grants the discovery role "
                         f"and per-target {IAP_ROLE} with condition "
                         f"'{IAP_CONDITION_EXPRESSION}' before probe use; the "
                         "probe fails closed if the grant is missing")})

        def create_firewall():
            gcloud_json(prefix, argv["firewallCreate"])
            rows = gcloud_json(prefix, argv["firewallList"]) or []
            fw = rows[0] if rows else {}
            allowed = fw.get("allowed") or []
            ports = sorted(p for e in allowed for p in (e.get("ports") or ["ALL"]))
            if (ports != ["22"] or any(e.get("IPProtocol") != "tcp" for e in allowed)
                    or fw.get("sourceRanges") != [cfg["iapRange"]]
                    or fw.get("targetTags") != [ctrl["tag"]]):
                raise ControllerError("controller firewall readback is not "
                                      "exactly IAP-range tcp:22 for the "
                                      "controller tag; not claiming success")
            return {"name": fw.get("name"), "ports": ports,
                    "sourceRanges": fw.get("sourceRanges")}
        stage(receipt, "controllerFirewall", create_firewall)

        def create_controller():
            with open(ssh_keys_path, "w", encoding="utf-8") as fh:
                fh.write(f"{ctrl['operatorUsername']}:{ctrl['operatorSshPublicKey']}\n")
            out = gcloud_json(prefix, argv["controllerCreate"])
            inst = out[0] if isinstance(out, list) and out else (out or {})
            if not str(inst.get("id", "")).isdigit() or inst.get("name") != ctrl["name"]:
                raise ControllerError("controller create returned no matching "
                                      "numeric instance identity; not claiming PASS")
            emails = [s.get("email") for s in inst.get("serviceAccounts", [])]
            if emails != [email]:
                raise ControllerError(f"controller readback service accounts "
                                      f"{emails} != [{email}]")
            nat = [a.get("natIP") for n in inst.get("networkInterfaces", [])
                   for a in (n.get("accessConfigs") or [])]
            return {"id": str(inst.get("id")), "name": inst.get("name"),
                    "status": inst.get("status"), "serviceAccount": email,
                    "ephemeralExternalIp": bool(nat and nat[0]),
                    "note": ("ephemeral external IP retained for egress: no "
                             "Cloud NAT exists in this region; no inbound "
                             "exposure beyond IAP-only tcp:22")}
        stage(receipt, "controllerInstance", create_controller)
        receipt["result"] = "PASS"
    except ControllerError as exc:
        receipt["failure"] = str(exc)
    except subprocess.TimeoutExpired as exc:
        receipt["result"] = "UNCERTAIN"
        receipt["failure"] = ("subprocess timeout — the last mutation may or "
                              "may not have applied; reconcile manually, do "
                              "not replay: " + redact(exc))
    receipt["endedAt"] = utc_now()
    write_receipt(receipt_path, receipt)
    print(json.dumps({"result": receipt["result"], "receipt": receipt_path,
                      "failure": receipt["failure"]}, indent=2))
    return 0 if receipt["result"] == "PASS" else 1


def probe_env(private_config_dir):
    env = {k: v for k, v in os.environ.items()
           if not k.startswith("CLOUDSDK_") and k not in STRIPPED_ENV_EXACT}
    env["CLOUDSDK_CONFIG"] = private_config_dir
    return env


def verify_attached_identity(cfg):
    """R1: require the metadata-attached service account to be exactly the
    dedicated controller SA. Fails closed off-controller or under any other
    identity; a scrubbed environment alone does not prove the identity."""
    base = os.environ.get("CLAWX_CONTROLLER_TEST_METADATA_BASE", METADATA_BASE)
    if base != METADATA_BASE and not base.startswith("http://127.0.0.1"):
        raise ControllerError("metadata test override must target loopback")
    url = base + "/computeMetadata/v1/instance/service-accounts/default/email"
    req = urllib.request.Request(url, headers={"Metadata-Flavor": "Google"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            got = resp.read().decode("utf-8").strip()
    except OSError as exc:
        raise ControllerError(
            "refusing: metadata server unreachable — probe must run ON the "
            "controller with its attached service account (" + redact(exc) + ")")
    if got != sa_email(cfg):
        raise ControllerError(
            f"refusing: attached service account {got!r} is not the expected "
            f"controller identity {sa_email(cfg)!r}")
    return got


def pick_local_port(requested):
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", requested or 0))
        except OSError:
            raise ControllerError(
                f"refusing: requested local port {requested} is occupied; a "
                "stale listener is never trusted — pick another port")
        return sock.getsockname()[1]


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            return True
    except OSError:
        return False


def tail(path, limit=400):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return redact(fh.read()[-limit:])
    except OSError:
        return ""


def kill_owned(proc):
    """Terminate ONLY our own child. R3: killpg is used only when the child
    is provably its own group leader (pgid == the pid we created with
    start_new_session); on any mismatch fall back to terminating the single
    child process — never another group, never pattern matching."""
    if proc.poll() is not None:
        return
    try:
        pgid = os.getpgid(proc.pid)
    except (ProcessLookupError, PermissionError):
        return
    try:
        if pgid == proc.pid:
            os.killpg(pgid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(pgid, signal.SIGKILL)
                proc.wait(timeout=5)
        else:  # unexpected group identity: safe fallback, child only
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
    except (ProcessLookupError, PermissionError):
        pass


def start_tunnel(prefix, cfg, tgt, remote_port, local_port, env, log_path, wait_s):
    argv = prefix + ["compute", "start-iap-tunnel", tgt["name"], str(remote_port),
                     f"--local-host-port=127.0.0.1:{local_port}",
                     f"--zone={tgt['zone']}", f"--project={cfg['project']}"]
    with open(log_path, "wb") as logf:
        proc = subprocess.Popen(argv, stdout=logf, stderr=subprocess.STDOUT,
                                env=env, start_new_session=True)
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        if port_open(local_port):
            return proc
        if proc.poll() is not None:
            raise ControllerError(
                f"tunnel to {tgt['name']}:{remote_port} exited "
                f"(code {proc.returncode}): {tail(log_path)}")
        time.sleep(0.2)
    kill_owned(proc)
    raise ControllerError(f"tunnel to {tgt['name']}:{remote_port} did not bind "
                          f"127.0.0.1:{local_port} within {wait_s}s")


def classify_denial(text):
    """R2: only an EXPLICIT permission denial proves the IAP restriction.
    A closed backend port is a different fact and never a permission PASS."""
    if re.search(r"403|permission[ _-]?denied|PERMISSION_DENIED|access.{0,10}denied",
                 text, re.I):
        return {"outcome": "BLOCKED_IAM", "detail": text}
    if re.search(r"4003|failed to connect to backend", text, re.I):
        return {"outcome": "INCONCLUSIVE_BACKEND", "detail": (
            "backend/port closed — this does NOT prove the IAM port "
            "restriction; rerun against a port that is open on the guest: "
            + text)}
    return None


def denied_control(prefix, cfg, tgt, env, log_path, wait_s):
    """Negative control against an UNAUTHORIZED port. A local listener bind —
    or even an accepted local TCP connect — is NOT remote access (R2): the
    control connects through the tunnel and requires either remote protocol
    data (FAIL_OPEN) or an explicit permission denial (BLOCKED_IAM). Anything
    else is a FAIL/INCONCLUSIVE outcome, never a pass."""
    port = cfg["probe"]["deniedControlPort"]
    local_port = pick_local_port(None)
    argv = prefix + ["compute", "start-iap-tunnel", tgt["name"], str(port),
                     f"--local-host-port=127.0.0.1:{local_port}",
                     f"--zone={tgt['zone']}", f"--project={cfg['project']}"]
    with open(log_path, "wb") as logf:
        proc = subprocess.Popen(argv, stdout=logf, stderr=subprocess.STDOUT,
                                env=env, start_new_session=True)
    deadline = time.monotonic() + wait_s
    next_connect = 0.0
    try:
        while time.monotonic() < deadline:
            if port_open(local_port) and time.monotonic() >= next_connect:
                next_connect = time.monotonic() + 1.0
                try:  # a REAL connection through the tunnel, not a bind check
                    with socket.create_connection(("127.0.0.1", local_port),
                                                  timeout=5) as sock:
                        sock.settimeout(8)
                        try:
                            data = sock.recv(64)
                        except OSError:
                            data = b""
                except OSError:
                    data = b""
                if data:
                    return {"outcome": "FAIL_OPEN", "detail": (
                        f"unauthorized port {port} returned remote protocol "
                        f"data {data[:16]!r}; IAP restriction is NOT effective")}
                # no remote data: keep waiting for the tunnel's own verdict
            if proc.poll() is not None:
                verdict = classify_denial(tail(log_path))
                if verdict:
                    return verdict
                return {"outcome": "FAIL", "detail": "tunnel exited without an "
                        "explicit denial: " + tail(log_path)}
            time.sleep(0.2)
        verdict = classify_denial(tail(log_path))
        if verdict:
            return verdict
        return {"outcome": "FAIL",
                "detail": f"no explicit denial within {wait_s}s; control "
                          "inconclusive"}
    finally:
        kill_owned(proc)


def cmd_probe(args):
    cfg = load_config(args.config)
    blockers = config_blockers(cfg)
    if blockers:
        raise ControllerError("refusing probe: " + "; ".join(blockers))
    matches = [t for t in cfg["targets"] if t["name"] == args.target]
    if not matches:
        raise ControllerError(f"refusing: target {args.target!r} is not in the "
                              "allowlisted config targets")
    tgt, probe_cfg = matches[0], cfg["probe"]
    for label in ("privateKeyPath", "knownHostsPath"):
        if not os.path.isfile(os.path.expanduser(probe_cfg[label])):
            raise ControllerError(f"refusing: probe.{label} "
                                  f"{probe_cfg[label]!r} does not exist (root "
                                  "supplies guest key/known_hosts privately)")
    identity = verify_attached_identity(cfg)  # R1: fail closed off-controller
    probe_id = f"{tgt['name']}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{os.getpid()}"
    private_cfg_dir = os.path.join(args.receipt_dir, "gcloud-config", probe_id)
    os.makedirs(private_cfg_dir)
    env = probe_env(private_cfg_dir)
    prefix = resolve_gcloud(env)
    if not shutil.which("ssh", path=env.get("PATH")):
        raise ControllerError("ssh (OpenSSH client) not found on PATH; install "
                              "it on the controller first — failing status")
    locks_dir = os.path.join(args.receipt_dir, "locks")
    probes_dir = os.path.join(args.receipt_dir, "probes")
    os.makedirs(locks_dir, exist_ok=True)
    os.makedirs(probes_dir, exist_ok=True)
    lock_path = os.path.join(locks_dir, f"{tgt['name']}.lock.json")
    take_lock(lock_path, {"probeId": probe_id, "target": tgt["name"]})
    receipt = base_record(args, cfg)
    receipt.update({"command": "probe", "probeId": probe_id,
                    "target": {"name": tgt["name"], "instanceId": tgt["instanceId"]},
                    "startedAt": utc_now(),
                    "attachedServiceAccount": identity,
                    "privateCloudsdkConfig": private_cfg_dir,
                    "scrubbedEnv": sorted(
                        k for k in os.environ
                        if k.startswith("CLOUDSDK_") or k in STRIPPED_ENV_EXACT),
                    "checks": [], "result": "FAIL", "failure": None})
    wait_s = int(probe_cfg.get("tunnelWaitSeconds", 45))
    uncertain, tunnel = False, None
    try:
        got = gcloud_json(prefix, build_argv(cfg)[
            f"target{cfg['targets'].index(tgt)}Describe"], env=env)
        got = got or {}
        if str(got.get("id")) != str(tgt["instanceId"]):
            raise ControllerError(
                f"refusing: target ID readback {got.get('id')!r} != "
                f"allowlisted {tgt['instanceId']!r}")
        receipt["checks"].append({"check": "targetIdentity", "outcome": "PASS",
                                  "id": str(got.get("id")),
                                  "status": got.get("status")})
        local_port = pick_local_port(args.local_port)
        log_path = os.path.join(probes_dir, f"{probe_id}.tunnel.log")
        tunnel = start_tunnel(prefix, cfg, tgt, 22, local_port, env,
                              log_path, wait_s)
        with socket.create_connection(("127.0.0.1", local_port), timeout=10) as sock:
            sock.settimeout(10)
            banner = sock.recv(128)
        if not banner.startswith(b"SSH-"):
            raise ControllerError(f"expected an SSH banner, got {banner!r}")
        receipt["checks"].append({"check": "sshBanner", "outcome": "PASS",
                                  "banner": banner.decode("utf-8", "replace").strip()})
        marker = probe_cfg.get("marker", "CLAWX_CONTROLLER_ACCESS_OK")
        # R4: `--` terminates options BEFORE the destination so nothing leaks
        # into the remote (Windows) command line; -F /dev/null isolates any
        # user ssh config and SSH_AUTH_SOCK is scrubbed from the environment.
        ssh_argv = ["ssh", "-F", "/dev/null", "-p", str(local_port),
                    "-o", "BatchMode=yes",
                    "-o", "StrictHostKeyChecking=yes",
                    "-o", f"UserKnownHostsFile={os.path.expanduser(probe_cfg['knownHostsPath'])}",
                    "-o", "GlobalKnownHostsFile=/dev/null",
                    "-o", "IdentitiesOnly=yes",
                    "-o", f"HostKeyAlias={tgt['name']}",
                    "-o", "ConnectTimeout=20",
                    "-i", os.path.expanduser(probe_cfg["privateKeyPath"]),
                    "--", f"{tgt['sshUsername']}@127.0.0.1", f"echo {marker}"]
        try:
            ssh = subprocess.run(ssh_argv, capture_output=True, text=True,
                                 env=env, start_new_session=True,
                                 timeout=int(probe_cfg.get("authTimeoutSeconds", 60)))
        except subprocess.TimeoutExpired:
            uncertain = True
            raise ControllerError(
                "authenticated marker SSH timed out — outcome UNCERTAIN; the "
                "lock is kept, reconcile manually before another probe")
        if ssh.returncode == 0 and marker in ssh.stdout.splitlines():
            receipt["checks"].append({"check": "authenticatedMarker",
                                      "outcome": "PASS", "exit": 0})
        else:
            receipt["checks"].append({
                "check": "authenticatedMarker", "outcome": "FAIL",
                "exit": ssh.returncode, "stderrTail": redact(ssh.stderr[-300:])})
            raise ControllerError(
                f"authenticated marker failed (ssh exit {ssh.returncode}); "
                "strict host-key checking and key auth are required")
        kill_owned(tunnel)
        tunnel = None
        control = denied_control(prefix, cfg, tgt, env,
                                 os.path.join(probes_dir, f"{probe_id}.control.log"),
                                 wait_s)
        receipt["checks"].append({"check": "deniedPortControl", **control})
        if control["outcome"] != "BLOCKED_IAM":  # R2: only explicit denial passes
            raise ControllerError(
                "denied-port negative control did not produce an explicit "
                f"permission denial ({control['outcome']}): " + control["detail"])
        receipt["result"] = "PASS"
    except ControllerError as exc:
        receipt["failure"] = str(exc)
    except Exception as exc:  # unexpected → uncertain, keep the lock
        uncertain = True
        receipt["failure"] = "unexpected error (UNCERTAIN): " + redact(exc)
    finally:
        if tunnel is not None:
            kill_owned(tunnel)
    if uncertain:
        receipt["result"] = "UNCERTAIN"
    receipt["endedAt"] = utc_now()
    receipt_path = os.path.join(probes_dir, f"{probe_id}.receipt.json")
    write_receipt(receipt_path, receipt)
    if not uncertain:
        os.unlink(lock_path)  # definite outcome (PASS or FAIL) releases the lock
    print(json.dumps({"result": receipt["result"], "probeId": probe_id,
                      "receipt": receipt_path, "lockHeld": uncertain,
                      "failure": receipt["failure"]}, indent=2))
    return 0 if receipt["result"] == "PASS" else 1


def main(argv=None):
    default_config = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "controller-config.example.json")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan")
    boot = sub.add_parser("bootstrap")
    probe = sub.add_parser("probe")
    for sp in (plan, boot, probe):
        sp.add_argument("--config", default=default_config)
    boot.add_argument("--run-id", required=True)
    boot.add_argument("--controller", required=True,
                      help="must exactly repeat config controller.name")
    boot.add_argument("--receipt-dir", required=True)
    probe.add_argument("--target", required=True)
    probe.add_argument("--receipt-dir", required=True)
    probe.add_argument("--local-port", type=int, default=None)
    args = parser.parse_args(argv)
    try:
        return {"plan": cmd_plan, "bootstrap": cmd_bootstrap,
                "probe": cmd_probe}[args.command](args)
    except ControllerError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
