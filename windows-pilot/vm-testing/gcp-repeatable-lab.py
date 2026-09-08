#!/usr/bin/env python3
"""Repeatable Windows GCP lab launcher (CLWX-25 / CLWX-106 / CLWX-133).

Provisions ONE fresh Windows Server 2022 lab VM per unique --run-id from a
pinned Google public image into the dedicated isolated network
`clawx-test-lab`. It never touches, clones or reuses the owner's VM: initial
repeatability is recreation from the pinned public image, NOT a golden-image
snapshot of any signed-in state.

Commands:
  plan    Read-only. Prints the exact gcloud argv this launcher would run.
          Spawns no subprocess at all.
  create  Provisions after fail-closed validation: exact image name + numeric
          image ID readback, no preexisting instance/receipt/lock, existing
          lab network/subnet/firewall must match the pinned config exactly
          (drift refuses), protected owner targets refuse.

There is deliberately NO delete/reset/stop/auto-cleanup in this version.
Provisioning success proves only that a new instance exists. Reachability
evidence stays with gcp-iap-lane.sh (RDP/SSH protocol probes plus the closed
guest :9999 negative control) and the authenticated SSH marker; installer
acceptance is a separate workflow. See docs/testing/WINDOWS_REPEATABLE_LAB.md.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone

RUN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$")
INSTANCE_PREFIX = "clawx-lab-"
PLACEHOLDER = "PLACEHOLDER"
REQUIRED_KEYS = (
    "project", "region", "zone", "machineType", "bootDiskSizeGb",
    "bootDiskType", "network", "subnet", "subnetCidr", "tag", "iapRange",
    "firewall", "image", "metadata", "protectedInstances",
)


class LabError(Exception):
    """Fail-closed refusal; the launcher never converts one into a pass."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    missing = [key for key in REQUIRED_KEYS if key not in cfg]
    if missing:
        raise LabError(f"config {path} is missing required keys: {missing}")
    return cfg


def config_blockers(cfg: dict, cli_image) -> list:
    blockers = []
    image = cfg["image"]
    for key in ("name", "project", "id"):
        if PLACEHOLDER in str(image.get(key, "")).upper():
            blockers.append(
                f"image.{key} is a placeholder; root must pin the exact "
                "resolved Google public Windows Server 2022 image first"
            )
    if not str(image.get("id", "")).isdigit():
        blockers.append("image.id must be the exact numeric image ID")
    if cli_image is not None and cli_image != image.get("name"):
        blockers.append(
            f"--image {cli_image!r} does not exactly match pinned config "
            f"image.name {image.get('name')!r}"
        )
    for key, value in cfg["metadata"].items():
        if "," in str(value) or "=" in key:
            blockers.append(f"metadata key {key!r} has an unencodable value")
    return blockers


def validate_run_id(run_id: str) -> str:
    if not RUN_ID_RE.match(run_id or ""):
        raise LabError(
            "invalid --run-id: need 4-40 chars of [a-z0-9-], starting and "
            "ending alphanumeric"
        )
    name = INSTANCE_PREFIX + run_id
    if len(name) > 61:
        raise LabError(f"derived instance name {name!r} exceeds 61 chars")
    return name


def check_protected(cfg: dict, run_id: str, name: str) -> None:
    for protected in cfg.get("protectedInstances", []):
        if protected and (protected in run_id or protected in name):
            raise LabError(
                f"refusing: run-id/instance {name!r} collides with protected "
                f"owner target {protected!r}; this launcher never reuses or "
                "replaces an existing owner VM"
            )


def build_argv(cfg: dict, name: str) -> dict:
    project, image, fw = cfg["project"], cfg["image"], cfg["firewall"]
    metadata = ",".join(f"{k}={v}" for k, v in cfg["metadata"].items())
    rules = "tcp:" + ",tcp:".join(str(p) for p in fw["ports"])
    return {
        "imageDescribe": [
            "gcloud", "compute", "images", "describe", image["name"],
            f"--project={image['project']}", "--format=json"],
        "instanceList": [
            "gcloud", "compute", "instances", "list", f"--project={project}",
            f"--filter=name={name}", f"--zones={cfg['zone']}", "--format=json"],
        "networkList": [
            "gcloud", "compute", "networks", "list", f"--project={project}",
            f"--filter=name={cfg['network']}", "--format=json"],
        "subnetList": [
            "gcloud", "compute", "networks", "subnets", "list",
            f"--project={project}", f"--filter=name={cfg['subnet']}",
            f"--regions={cfg['region']}", "--format=json"],
        "firewallList": [
            "gcloud", "compute", "firewall-rules", "list",
            f"--project={project}", f"--filter=name={fw['name']}",
            "--format=json"],
        "networkCreate": [
            "gcloud", "compute", "networks", "create", cfg["network"],
            f"--project={project}", "--subnet-mode=custom", "--format=json",
            "--quiet"],
        "subnetCreate": [
            "gcloud", "compute", "networks", "subnets", "create",
            cfg["subnet"], f"--project={project}",
            f"--network={cfg['network']}", f"--region={cfg['region']}",
            f"--range={cfg['subnetCidr']}", "--format=json", "--quiet"],
        "firewallCreate": [
            "gcloud", "compute", "firewall-rules", "create", fw["name"],
            f"--project={project}", f"--network={cfg['network']}",
            "--direction=INGRESS", "--action=ALLOW", f"--rules={rules}",
            f"--source-ranges={cfg['iapRange']}",
            f"--target-tags={cfg['tag']}", "--format=json", "--quiet"],
        "instanceCreate": [
            "gcloud", "compute", "instances", "create", name,
            f"--project={project}", f"--zone={cfg['zone']}",
            f"--machine-type={cfg['machineType']}",
            f"--image={image['name']}", f"--image-project={image['project']}",
            f"--boot-disk-size={cfg['bootDiskSizeGb']}GB",
            f"--boot-disk-type={cfg['bootDiskType']}",
            f"--network-interface=subnet={cfg['subnet']}",
            f"--tags={cfg['tag']}", "--no-service-account", "--no-scopes",
            f"--metadata={metadata}", "--format=json", "--quiet"],
    }


def resolve_gcloud() -> list:
    path = shutil.which("gcloud")
    if not path:
        raise LabError("gcloud not found on PATH; refusing to guess")
    if path.lower().endswith((".cmd", ".bat")):
        return ["cmd.exe", "/c", path]
    return [path]


def gcloud_json(prefix: list, argv: list):
    proc = subprocess.run(  # argv exec, never shell=True
        prefix + argv[1:], capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise LabError(
            f"gcloud failed (exit {proc.returncode}): {' '.join(argv)}\n"
            + proc.stderr.strip()[:2000])
    return json.loads(proc.stdout) if proc.stdout.strip() else None


def check_network(existing: dict, _cfg: dict):
    if existing.get("autoCreateSubnetworks") is not False:
        return "network subnet mode is not custom"
    return None


def check_subnet(existing: dict, cfg: dict):
    if existing.get("ipCidrRange") != cfg["subnetCidr"]:
        return f"subnet CIDR {existing.get('ipCidrRange')!r} != {cfg['subnetCidr']!r}"
    if not str(existing.get("network", "")).endswith("/" + cfg["network"]):
        return "subnet is attached to a different network"
    if not str(existing.get("region", "")).endswith("/" + cfg["region"]):
        return "subnet is in a different region"
    return None


def check_firewall(existing: dict, cfg: dict):
    fw = cfg["firewall"]
    allowed = existing.get("allowed") or []
    want_ports = sorted(str(p) for p in fw["ports"])
    if (len(allowed) != 1 or allowed[0].get("IPProtocol") != "tcp"
            or sorted(allowed[0].get("ports") or []) != want_ports):
        return f"firewall allowed rules != tcp:{want_ports}"
    if existing.get("sourceRanges") != [cfg["iapRange"]]:
        return "firewall source ranges are not exactly the IAP range"
    if existing.get("targetTags") != [cfg["tag"]]:
        return "firewall target tags do not match the lab tag"
    if existing.get("direction") != "INGRESS" or existing.get("disabled") is True:
        return "firewall direction/disabled state is wrong"
    if not str(existing.get("network", "")).endswith("/" + cfg["network"]):
        return "firewall is attached to a different network"
    return None


def ensure_lab_resource(prefix, label, list_argv, create_argv, checker, cfg):
    rows = gcloud_json(prefix, list_argv) or []
    if len(rows) > 1:
        raise LabError(f"{label}: ambiguous — {len(rows)} resources matched")
    if rows:
        drift = checker(rows[0], cfg)
        if drift:
            raise LabError(
                f"refusing drift: existing {label} does not exactly match the "
                f"pinned lab config ({drift}); fix or remove it deliberately, "
                "this launcher will not adopt or mutate it")
        return False
    gcloud_json(prefix, create_argv)
    return True


def base_record(args, cfg, name):
    return {
        "schema": "clawx-repeatable-lab/1",
        "runId": args.run_id,
        "instanceName": name,
        "launcherPath": os.path.abspath(__file__),
        "launcherSha256": sha256_file(__file__),
        "configPath": os.path.abspath(args.config),
        "configSha256": sha256_file(args.config),
        "image": dict(cfg["image"]),
        "argv": build_argv(cfg, name),
    }


def cmd_plan(args) -> int:
    cfg = load_config(args.config)
    name = validate_run_id(args.run_id)
    check_protected(cfg, args.run_id, name)
    plan = base_record(args, cfg, name)
    plan.update({
        "command": "plan", "mutation": False,
        "blockers": config_blockers(cfg, args.image),
        "note": ("plan spawned no subprocess; create mutates only the "
                 "dedicated named lab resources listed in argv"),
    })
    print(json.dumps(plan, indent=2))
    return 2 if plan["blockers"] else 0


def cmd_create(args) -> int:
    started, t0 = utc_now(), time.monotonic()
    cfg = load_config(args.config)
    name = validate_run_id(args.run_id)
    check_protected(cfg, args.run_id, name)
    blockers = config_blockers(cfg, args.image)
    if args.image is None:
        blockers.append("create requires --image exactly matching the pinned "
                        "config image.name (double-entry confirmation)")
    if blockers:
        raise LabError("refusing create: " + "; ".join(blockers))

    os.makedirs(args.receipt_dir, exist_ok=True)
    receipt_path = os.path.join(args.receipt_dir, f"{args.run_id}.receipt.json")
    lock_path = os.path.join(args.receipt_dir, f"{args.run_id}.lock.json")
    if os.path.exists(receipt_path):
        raise LabError(
            f"refusing: receipt already exists at {receipt_path}; run-ids are "
            "single-use and receipts are immutable — pick a new --run-id")
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise LabError(
            f"refusing: run lock already exists at {lock_path}; another "
            "operator/attempt owns this run-id and stale takeover is unsafe")
    with os.fdopen(lock_fd, "w", encoding="utf-8") as fh:
        json.dump({"runId": args.run_id, "pid": os.getpid(),
                   "host": socket.gethostname(), "startedAt": started}, fh)

    receipt = base_record(args, cfg, name)
    receipt.update({"command": "create", "startedAt": started,
                    "created": {}, "instance": None, "result": "FAIL",
                    "failure": None, "providerPackagesNote": (
                        "google-compute-engine-ssh is installed via googet at "
                        "sysprep-specialize and is NOT hermetically pinned; "
                        "record `googet installed` output post-boot")})
    try:
        prefix = resolve_gcloud()
        image = gcloud_json(prefix, receipt["argv"]["imageDescribe"]) or {}
        receipt["image"]["readbackId"] = str(image.get("id", ""))
        receipt["image"]["readbackName"] = image.get("name")
        if (str(image.get("id", "")) != str(cfg["image"]["id"])
                or image.get("name") != cfg["image"]["name"]):
            raise LabError(
                "refusing: image identity readback mismatch — config pins "
                f"{cfg['image']['name']}/{cfg['image']['id']}, gcloud returned "
                f"{image.get('name')}/{image.get('id')}")
        if gcloud_json(prefix, receipt["argv"]["instanceList"]) or []:
            raise LabError(
                f"refusing: instance {name} already exists; an existing VM is "
                "never reused as a fresh lab — pick a new --run-id")
        for label, checker in (("network", check_network),
                               ("subnet", check_subnet),
                               ("firewall", check_firewall)):
            receipt["created"][label] = ensure_lab_resource(
                prefix, label, receipt["argv"][f"{label}List"],
                receipt["argv"][f"{label}Create"], checker, cfg)
        out = gcloud_json(prefix, receipt["argv"]["instanceCreate"])
        instance = out[0] if isinstance(out, list) and out else out
        instance_id = str((instance or {}).get("id", ""))
        if not instance_id.isdigit():
            raise LabError("instance create returned no numeric instance ID; "
                           "not claiming PASS")
        receipt["instance"] = {"id": instance_id,
                               "name": (instance or {}).get("name"),
                               "status": (instance or {}).get("status"),
                               "zone": cfg["zone"]}
        receipt["result"] = "PASS"
    except LabError as exc:
        receipt["failure"] = str(exc)
    receipt["endedAt"] = utc_now()
    receipt["durationSeconds"] = round(time.monotonic() - t0, 3)
    receipt_fd = os.open(receipt_path,
                         os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o444)
    with os.fdopen(receipt_fd, "w", encoding="utf-8") as fh:
        json.dump(receipt, fh, indent=2)
    os.chmod(receipt_path, 0o444)
    print(json.dumps({"result": receipt["result"], "runId": args.run_id,
                      "instance": receipt["instance"],
                      "receipt": receipt_path,
                      "failure": receipt["failure"]}, indent=2))
    return 0 if receipt["result"] == "PASS" else 1


def main(argv=None) -> int:
    default_config = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "lab-baseline.json")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for cmd in ("plan", "create"):
        sp = sub.add_parser(cmd)
        sp.add_argument("--run-id", required=True)
        sp.add_argument("--config", default=default_config)
        sp.add_argument("--image", default=None)
        if cmd == "create":
            sp.add_argument("--receipt-dir", required=True)
    args = parser.parse_args(argv)
    try:
        return cmd_plan(args) if args.command == "plan" else cmd_create(args)
    except LabError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
