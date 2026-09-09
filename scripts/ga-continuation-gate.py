#!/usr/bin/env python3
"""ga-continuation-gate: deterministic GA continuation completion gate.

Supplements the native /goal evaluator, which only sees the conversation.
This gate re-derives an execution/evidence verdict from shared Git plus a
release manifest and, as a Stop hook, blocks a premature "all executable GA
work exhausted" stop while independently reviewed lanes remain unintegrated
or unproven in the candidate.

Modes:
  arm     Register a narrowly scoped per-session evidence contract
          (candidate ref + reviewed lanes + manifest path). Recording a
          lane records supplied independent approval; arming does NOT
          itself approve any code.
  check   Re-derive the JSON verdict from Git/manifest. Exit 0 only on
          PROVENANCE_RECONCILED (a scoped check, not a GA verdict);
          nonzero for NOT_READY/BLOCKED/UNARMED.
  disarm  Explicitly disable exactly one session's contract.
  hook    Stop-hook entrypoint (stdin JSON: session_id/cwd/stop_hook_active).
          Emits {} when this session/repo is not armed; decision:block with
          a concrete resume instruction when registered work remains; and
          after two identical failed continuations, continue:false with a
          STALLED / GA RED stopReason (never a pass).

Stdlib only. Bounded read-only git subprocess checks (argument arrays, no
shell, per-command timeout, overall budget) and private atomic state writes
under <repo>/.claude/ga-continuation/<session-uuid>/ (0700 dirs, 0600
files). No network, builds, tests, transcripts, or credential reads.
"""
import argparse
import hashlib
import json
import os
import shlex
import re
import subprocess
import sys
import tempfile
import time
import uuid

GATE = "ga-continuation-gate"
STATE_SUBDIR = os.path.join(".claude", "ga-continuation")

MAX_STDIN_BYTES = 1024 * 1024
MAX_STATE_BYTES = 256 * 1024
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_LANES = 32
MAX_LANE_FILES = 10000
MAX_WORKTREES = 256
MAX_SCAN_PATHS = 500  # total product paths compared across the scan
PRODUCT_PREFIXES = ("electron/", "src/", "resources/", "extensions/",
                    "windows-pilot/")
PRODUCT_FILES = ("package.json", "pnpm-lock.yaml", "electron-builder.yml")
MAX_REASON_CHARS = 1500
PER_COMMAND_TIMEOUT = 2.0
TOTAL_CHECK_BUDGET = 10.0
MAX_BLOCK_ATTEMPTS = 2  # corrective block responses per identical evidence

SESSION_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$")
CARD_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.+-]{0,99}$")

SCOPE_NOTE = (
    "Scoped provenance check of the registered lanes only; NOT a GA "
    "verdict. Artifact byte validation, installed-build, tenant and "
    "stakeholder gates remain mandatory elsewhere.")


class GateError(Exception):
    """Carries only a sanitized code; never raw input/git stderr."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class Budget:
    def __init__(self, seconds=TOTAL_CHECK_BUDGET):
        self.deadline = time.monotonic() + seconds

    def slice(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise GateError("budget-exhausted")
        return min(PER_COMMAND_TIMEOUT, remaining)


# ---------------------------------------------------------------- git helpers

def run_git(repo, args, budget):
    """Read-only git invocation: argument array, no shell, bounded."""
    try:
        proc = subprocess.run(
            ["git", "-C", repo] + list(args),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, timeout=budget.slice(),
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except (subprocess.TimeoutExpired, OSError):
        raise GateError("git-%s-failed" % args[0])
    if proc.returncode != 0:
        raise GateError("git-%s-failed" % args[0])
    if len(proc.stdout) > MAX_GIT_OUTPUT_BYTES:
        raise GateError("git-output-too-large")
    return proc.stdout


def valid_ref(ref):
    return (isinstance(ref, str) and REF_RE.fullmatch(ref)
            and ".." not in ref and not ref.endswith(".lock"))


def resolve_commit(repo, ref, budget):
    if not valid_ref(ref):
        raise GateError("ref-invalid")
    out = run_git(repo, ["rev-parse", "--verify", "--quiet",
                         ref + "^{commit}"], budget)
    sha = out.decode("ascii", "replace").strip()
    if not COMMIT_RE.fullmatch(sha):
        raise GateError("ref-unresolvable")
    return sha


def git_common_dir(path, budget):
    out = run_git(path, ["rev-parse", "--git-common-dir"], budget)
    common = out.decode("utf-8", "replace").strip()
    if not os.path.isabs(common):
        common = os.path.join(path, common)
    return os.path.realpath(common)


def lane_delta(repo, base, head, budget):
    """Net BASE..HEAD delta: {path: (old_mode, old_sha, new_mode, new_sha)}."""
    out = run_git(repo, ["diff-tree", "-r", "-z", "--no-renames",
                         "--full-index", "--raw", base, head], budget)
    fields = out.split(b"\0")
    delta = {}
    i = 0
    while i + 1 < len(fields) and fields[i]:
        header = fields[i].decode("utf-8", "replace")
        path = fields[i + 1].decode("utf-8", "surrogateescape")
        i += 2
        if not header.startswith(":"):
            raise GateError("diff-parse-failed")
        parts = header[1:].split(" ")
        if len(parts) < 5:
            raise GateError("diff-parse-failed")
        old_mode, new_mode, old_sha, new_sha = parts[0], parts[1], parts[2], parts[3]
        delta[path] = (old_mode, old_sha, new_mode, new_sha)
        if len(delta) > MAX_LANE_FILES:
            raise GateError("lane-too-large")
    return delta


def tree_entry(repo, commit_sha, path, budget):
    """Exact (mode, sha) tree entry for path in commit, or None if absent."""
    out = run_git(repo, ["ls-tree", "-z", "-r", "--full-tree", commit_sha,
                         "--", ":(literal)" + path], budget)
    for record in out.split(b"\0"):
        if not record:
            continue
        meta, _, entry_path = record.partition(b"\t")
        if entry_path.decode("utf-8", "surrogateescape") != path:
            return None  # path replaced by a directory etc. -> not this entry
        parts = meta.decode("utf-8", "replace").split(" ")
        if len(parts) != 3:
            raise GateError("ls-tree-parse-failed")
        return (parts[0], parts[2])
    return None


def is_absent(mode, sha):
    return set(sha) == {"0"} or mode == "000000"


def check_lane(repo, lane, candidate_sha, budget):
    """Returns (row, head_entries) where head_entries maps each changed
    path to its reviewed-head tree entry (None for a reviewed delete)."""
    delta = lane_delta(repo, lane["baseSha"], lane["headSha"], budget)
    head_entries = {}
    matched_head = matched_base = divergent = 0
    for path, (old_mode, old_sha, new_mode, new_sha) in delta.items():
        head_entries[path] = None if is_absent(new_mode, new_sha) \
            else (new_mode, new_sha)
        actual = tree_entry(repo, candidate_sha, path, budget)
        head_absent = is_absent(new_mode, new_sha)
        base_absent = is_absent(old_mode, old_sha)
        if (actual is None and head_absent) or actual == (new_mode, new_sha):
            matched_head += 1
        elif (actual is None and base_absent) or actual == (old_mode, old_sha):
            matched_base += 1
        else:
            divergent += 1
    if not delta:
        status = "EMPTY"
    elif divergent:
        status = "DIVERGENT"
    elif matched_base:
        status = "PENDING"
    else:
        status = "INTEGRATED"
    row = {"card": lane["card"], "base": lane["baseSha"],
           "head": lane["headSha"], "files": len(delta),
           "matchedHead": matched_head, "matchedBase": matched_base,
           "divergent": divergent, "status": status}
    return row, head_entries


def list_worktrees(repo, budget):
    out = run_git(repo, ["worktree", "list", "--porcelain"], budget)
    block = {}
    blocks = []
    for line in out.decode("utf-8", "surrogateescape").splitlines() + [""]:
        if not line:
            if block:
                blocks.append(block)
            block = {}
            continue
        key, _, value = line.partition(" ")
        block[key] = value
    if len(blocks) > MAX_WORKTREES:
        raise GateError("worktree-limit-exceeded")
    return blocks


def candidate_worktree_status(repo, candidate_ref, candidate_sha, budget):
    """If a worktree has the candidate checked out, is it clean?"""
    full_ref = None
    try:
        out = run_git(repo, ["rev-parse", "--symbolic-full-name",
                             candidate_ref], budget)
        symbolic = out.decode("utf-8", "replace").strip()
        full_ref = symbolic if symbolic.startswith("refs/heads/") else None
    except GateError:
        pass  # candidate may be a raw SHA
    checked = False
    dirty_entries = 0
    for wt in list_worktrees(repo, budget):
        path = wt.get("worktree")
        if not path or not os.path.isdir(path):
            continue
        matches = (wt.get("branch") == full_ref if full_ref else
                   wt.get("HEAD") == candidate_sha)
        if not matches:
            continue
        checked = True
        status = run_git(path, ["status", "--porcelain"], budget)
        lines = [l for l in status.decode("utf-8", "surrogateescape").splitlines() if l]
        dirty_entries += len(lines)
    return {"checked": checked, "dirty": dirty_entries > 0,
            "entries": dirty_entries}


def is_product_path(path):
    return path in PRODUCT_FILES or path.startswith(PRODUCT_PREFIXES)


def snapshot_worktrees(repo, budget):
    """Bounded path -> HEAD snapshot of all same-repo worktrees at arm."""
    snapshot = []
    for wt in list_worktrees(repo, budget):
        path, head = wt.get("worktree"), wt.get("HEAD")
        if path and head and COMMIT_RE.fullmatch(head):
            snapshot.append({"path": path, "headSha": head})
    return snapshot


def scan_worktrees(repo, contract, candidate_sha, lane_entries, budget):
    """Detect NEW or HEAD-ADVANCED worktrees whose net changed product-scope
    paths are neither represented in the current candidate nor covered by a
    registered reviewed lane. Read-only; never merges or discards anything.
    Unchanged legacy worktrees and non-product paths are ignored."""
    snapshot = {w["path"]: w["headSha"]
                for w in contract.get("worktreesAtArm", [])}
    cand_at_arm = contract.get("candidateShaAtArm")
    findings = []
    scanned_paths = 0
    for wt in list_worktrees(repo, budget):
        path, head = wt.get("worktree"), wt.get("HEAD")
        if not path or not head or not COMMIT_RE.fullmatch(head):
            continue
        if head == candidate_sha:
            continue  # candidate itself, or an exact clone of it
        snap = snapshot.get(path)
        if snap == head:
            continue  # unchanged since arm: not a new obligation
        if snap and COMMIT_RE.fullmatch(snap):
            kind, base = "advanced", snap
        else:
            kind = "new"
            try:
                out = run_git(repo, ["merge-base", cand_at_arm, head],
                              budget)
                base = out.decode("ascii", "replace").strip()
            except GateError:
                base = None
        unrepresented = 0
        scanned = True
        if base and COMMIT_RE.fullmatch(base):
            try:
                delta = lane_delta(repo, base, head, budget)
            except GateError:
                delta, scanned = {}, False
            for rel, (_om, _os, new_mode, new_sha) in delta.items():
                if not is_product_path(rel):
                    continue
                scanned_paths += 1
                if scanned_paths > MAX_SCAN_PATHS:
                    scanned = False
                    break
                entry = None if is_absent(new_mode, new_sha) \
                    else (new_mode, new_sha)
                if entry == tree_entry(repo, candidate_sha, rel, budget):
                    continue  # already represented in the candidate
                if rel in lane_entries and lane_entries[rel] == entry:
                    continue  # covered by a registered reviewed lane
                unrepresented += 1
        else:
            scanned = False
        if unrepresented or not scanned:
            findings.append({"worktree": path, "kind": kind, "head": head,
                             "unrepresented": unrepresented,
                             "scanned": scanned})
    status = "UNREGISTERED_WORK" if findings else "OK"
    return {"status": status, "findings": findings}


def repo_relative_file(repo, rel):
    """Absolute path for a validated repo-relative file, bounded to repo."""
    if not valid_relpath(rel):
        return None
    absolute = os.path.realpath(os.path.join(repo, rel))
    repo_real = os.path.realpath(repo)
    if absolute != repo_real and not absolute.startswith(repo_real + os.sep):
        return None
    return absolute


def candidate_package_version(repo, candidate_sha, budget):
    try:
        blob = run_git(repo, ["cat-file", "blob",
                              candidate_sha + ":package.json"], budget)
        pkg = json.loads(blob.decode("utf-8"))
        version = pkg.get("version") if isinstance(pkg, dict) else None
    except (GateError, ValueError):
        return None
    if isinstance(version, str) and VERSION_RE.fullmatch(version):
        return version
    return None


def check_pointer(repo, contract, candidate_sha, budget):
    """Maintained structured source pointer (e.g. docs/completion-state.json)
    must match the actual resolved candidate; optional, but absence of the
    option is NOT_CONFIGURED, never PASS."""
    rel = contract.get("candidateStatePath")
    if not rel:
        return {"status": "NOT_CONFIGURED", "path": None, "errors": []}
    result = {"status": "STALE", "path": rel, "errors": []}
    absolute = repo_relative_file(repo, rel)
    if absolute is None:
        result["errors"].append("pointer-path-invalid")
        return result
    if not os.path.isfile(absolute):
        result["errors"].append("pointer-missing")
        return result
    try:
        with open(absolute, "rb") as fh:
            raw = fh.read(MAX_MANIFEST_BYTES + 1)
        if len(raw) > MAX_MANIFEST_BYTES:
            result["errors"].append("pointer-too-large")
            return result
        state = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError):
        result["errors"].append("pointer-unreadable")
        return result
    pointer = state.get("currentSourceCandidate") \
        if isinstance(state, dict) else None
    if not isinstance(pointer, dict):
        result["errors"].append("pointer-schema-invalid")
        return result
    if pointer.get("source") != candidate_sha:
        result["errors"].append("pointer-source-mismatch")
    pkg_version = candidate_package_version(repo, candidate_sha, budget)
    if pkg_version is None or pointer.get("version") != pkg_version:
        result["errors"].append("pointer-version-mismatch")
    if not result["errors"]:
        result["status"] = "OK"
    return result


# ------------------------------------------------------------------ manifest

def valid_relpath(path):
    if not isinstance(path, str) or not path or len(path) > 300:
        return False
    if path.startswith("/") or "\\" in path or "\0" in path:
        return False
    parts = path.split("/")
    return all(p and p not in (".", "..") for p in parts)


def _check_artifact(row, candidate_sha, prefix, errors):
    sha256 = row.get("sha256")
    if not (isinstance(sha256, str) and SHA256_RE.fullmatch(sha256)):
        errors.append(prefix + "-sha256-malformed")
        sha256 = None
    nbytes = row.get("bytes")
    if not (isinstance(nbytes, int) and not isinstance(nbytes, bool)
            and nbytes > 0):
        errors.append(prefix + "-bytes-invalid")
    source = row.get("source")
    if not isinstance(source, dict):
        errors.append(prefix + "-source-missing")
        return sha256
    commit = source.get("gitCommit")
    if not (isinstance(commit, str) and COMMIT_RE.fullmatch(commit)):
        errors.append(prefix + "-source-commit-malformed")
    elif commit != candidate_sha:
        errors.append(prefix + "-source-commit-mismatch")
    if source.get("gitDirty") is not False:
        errors.append(prefix + "-source-dirty")
    return sha256


def check_manifest(repo, manifest_rel, candidate_sha, budget):
    result = {"path": manifest_rel, "status": "INVALID", "errors": [],
              "version": None, "installerSha256": None, "asarSha256": None}
    errors = result["errors"]
    if not valid_relpath(manifest_rel):
        errors.append("manifest-path-invalid")
        return result
    manifest_abs = os.path.realpath(os.path.join(repo, manifest_rel))
    repo_real = os.path.realpath(repo)
    if manifest_abs != repo_real and not manifest_abs.startswith(
            repo_real + os.sep):
        errors.append("manifest-path-outside-repo")
        return result
    if not os.path.isfile(manifest_abs):
        result["status"] = "MISSING"
        errors.append("manifest-missing")
        return result
    try:
        with open(manifest_abs, "rb") as fh:
            raw = fh.read(MAX_MANIFEST_BYTES + 1)
        if len(raw) > MAX_MANIFEST_BYTES:
            errors.append("manifest-too-large")
            return result
        manifest = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError):
        errors.append("manifest-unreadable")
        return result
    if not isinstance(manifest, dict):
        errors.append("manifest-not-object")
        return result
    version = manifest.get("version")
    if isinstance(version, str) and VERSION_RE.fullmatch(version):
        result["version"] = version
    else:
        errors.append("version-not-string")
        version = None
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        errors.append("artifacts-not-list")
        return result
    required = {}
    for row in artifacts:
        if not isinstance(row, dict):
            errors.append("artifact-row-invalid")
            continue
        kind = row.get("kind")
        if kind in ("installer", "asar"):
            if kind in required:
                errors.append(kind + "-duplicate")
            else:
                required[kind] = row
    for kind in ("installer", "asar"):
        if any(e.startswith(kind + "-duplicate") for e in errors):
            continue
        if kind not in required:
            errors.append(kind + "-missing")
            continue
        sha = _check_artifact(required[kind], candidate_sha, kind, errors)
        result[kind + "Sha256"] = sha
    # candidate package.json version must match the manifest version
    try:
        blob = run_git(repo, ["cat-file", "blob",
                              candidate_sha + ":package.json"], budget)
        pkg = json.loads(blob.decode("utf-8"))
        pkg_version = pkg.get("version") if isinstance(pkg, dict) else None
    except (GateError, ValueError):
        pkg_version = None
        errors.append("package-json-unreadable")
    if version is not None and pkg_version != version:
        errors.append("version-mismatch")
    if not errors:
        result["status"] = "OK"
    return result


# --------------------------------------------------------------- state files

def session_dir(repo, session):
    if not (isinstance(session, str) and SESSION_RE.fullmatch(session)):
        raise GateError("session-invalid")
    uuid.UUID(session)  # defense in depth
    return os.path.join(repo, STATE_SUBDIR, session)


def write_private(path, obj):
    directory = os.path.dirname(path)
    root = os.path.dirname(directory)
    for d in (root, directory):
        os.makedirs(d, mode=0o700, exist_ok=True)
        os.chmod(d, 0o700)
    payload = json.dumps(obj, sort_keys=True, indent=1).encode("utf-8")
    if len(payload) > MAX_STATE_BYTES:
        raise GateError("state-too-large")
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-")
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, payload)
        os.fsync(fd)
        os.close(fd)
        os.replace(tmp, path)  # atomic; concurrent writers cannot corrupt
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise GateError("state-write-failed")


def read_private(path):
    try:
        with open(path, "rb") as fh:
            raw = fh.read(MAX_STATE_BYTES + 1)
    except OSError:
        return None
    if len(raw) > MAX_STATE_BYTES:
        raise GateError("state-too-large")
    try:
        obj = json.loads(raw.decode("utf-8"))
    except ValueError:
        raise GateError("state-malformed")
    if not isinstance(obj, dict):
        raise GateError("state-malformed")
    return obj


def load_contract(repo, session):
    """None => not armed. GateError('contract-malformed') => fail closed."""
    path = os.path.join(session_dir(repo, session), "contract.json")
    if not os.path.exists(path):
        return None
    try:
        contract = read_private(path)
    except GateError:
        raise GateError("contract-malformed")
    if contract is None:
        # file exists but is unreadable: fail closed, never a silent pass
        raise GateError("contract-malformed")
    if contract.get("armed") is False:
        return None
    try:
        if (contract.get("version") != 1 or contract.get("armed") is not True
                or contract.get("session") != session
                or not valid_ref(contract.get("candidateRef"))
                or not valid_relpath(contract.get("manifestPath"))):
            raise GateError("contract-malformed")
        lanes = contract.get("lanes")
        if not (isinstance(lanes, list) and 1 <= len(lanes) <= MAX_LANES):
            raise GateError("contract-malformed")
        for lane in lanes:
            if not (isinstance(lane, dict)
                    and CARD_RE.fullmatch(str(lane.get("card")))
                    and COMMIT_RE.fullmatch(str(lane.get("baseSha")))
                    and COMMIT_RE.fullmatch(str(lane.get("headSha")))):
                raise GateError("contract-malformed")
        if not COMMIT_RE.fullmatch(str(contract.get("candidateShaAtArm"))):
            raise GateError("contract-malformed")
        worktrees = contract.get("worktreesAtArm")
        if not (isinstance(worktrees, list)
                and len(worktrees) <= MAX_WORKTREES):
            raise GateError("contract-malformed")
        for wt in worktrees:
            if not (isinstance(wt, dict) and isinstance(wt.get("path"), str)
                    and COMMIT_RE.fullmatch(str(wt.get("headSha")))):
                raise GateError("contract-malformed")
        state_path = contract.get("candidateStatePath")
        if state_path is not None and not valid_relpath(state_path):
            raise GateError("contract-malformed")
    except (TypeError, AttributeError):
        raise GateError("contract-malformed")
    return contract


# ------------------------------------------------------------------- verdict

def run_check(repo, session, contract):
    budget = Budget()
    verdict = {"gate": GATE, "session": session, "status": "BLOCKED",
               "code": None, "candidate": {"ref": contract["candidateRef"],
                                           "sha": None},
               "lanes": [], "manifest": None, "worktree": None,
               "nextStage": None, "scope": SCOPE_NOTE}
    try:
        candidate_sha = resolve_commit(repo, contract["candidateRef"], budget)
    except GateError as exc:
        verdict["code"] = "BLOCKED_CANDIDATE"
        verdict["candidate"]["error"] = exc.code
        verdict["nextStage"] = ("source/review correction: candidate ref "
                                "unresolvable; restore the candidate branch")
        return verdict
    verdict["candidate"]["sha"] = candidate_sha
    lanes = []
    lane_entries = {}
    for lane in contract["lanes"]:
        row, head_entries = check_lane(repo, lane, candidate_sha, budget)
        lanes.append(row)
        lane_entries.update(head_entries)
    verdict["lanes"] = lanes
    verdict["worktree"] = candidate_worktree_status(
        repo, contract["candidateRef"], candidate_sha, budget)
    verdict["worktreeScan"] = scan_worktrees(
        repo, contract, candidate_sha, lane_entries, budget)
    verdict["manifest"] = check_manifest(
        repo, contract["manifestPath"], candidate_sha, budget)
    verdict["pointerConsistency"] = check_pointer(
        repo, contract, candidate_sha, budget)

    divergent = sorted(l["card"] for l in lanes
                       if l["status"] in ("DIVERGENT", "EMPTY"))
    pending = sorted(l["card"] for l in lanes if l["status"] == "PENDING")
    if divergent:
        verdict["code"] = "BLOCKED_DIVERGENT"
        verdict["nextStage"] = (
            "source/review correction: lane(s) %s diverge from their "
            "reviewed bytes in the candidate; correct the source or "
            "register the independently reviewed combined slice"
            % ",".join(divergent))
    elif verdict["worktree"]["dirty"]:
        verdict["code"] = "BLOCKED_DIRTY"
        verdict["nextStage"] = ("integrate: candidate worktree has "
                                "uncommitted/untracked entries; commit or "
                                "register that pending work explicitly — "
                                "preserve unrelated files, do not clean or "
                                "discard others' work")
    elif pending:
        verdict["status"] = "NOT_READY"
        verdict["code"] = "NOT_READY_INTEGRATE"
        verdict["nextStage"] = ("integrate: reviewed lane(s) %s are not in "
                                "candidate %s" % (",".join(pending),
                                                  contract["candidateRef"]))
    elif verdict["worktreeScan"]["status"] != "OK":
        verdict["status"] = "NOT_READY"
        verdict["code"] = "UNREGISTERED_WORK"
        verdict["nextStage"] = (
            "register/review/disposition: %d worktree(s) contain product "
            "changes (electron/src/resources/extensions/windows-pilot/"
            "package files) not represented in the candidate and not "
            "covered by a registered reviewed lane; after independent "
            "review, register the lane (arm --lane) or record its explicit "
            "disposition — do not auto-merge or discard anything"
            % len(verdict["worktreeScan"]["findings"]))
    elif verdict["manifest"]["status"] != "OK":
        verdict["status"] = "NOT_READY"
        verdict["code"] = "NOT_READY_BUILD"
        verdict["nextStage"] = ("build/verify artifact: release manifest %s "
                                "is %s for candidate %s" % (
                                    contract["manifestPath"],
                                    "missing" if verdict["manifest"]["status"]
                                    == "MISSING" else "stale/invalid",
                                    candidate_sha[:12]))
    elif verdict["pointerConsistency"]["status"] not in ("OK",
                                                          "NOT_CONFIGURED"):
        verdict["status"] = "NOT_READY"
        verdict["code"] = "NOT_READY_POINTER"
        verdict["nextStage"] = (
            "correct the maintained source pointer: currentSourceCandidate "
            "in %s must record the actual candidate SHA %s and its package "
            "version" % (contract.get("candidateStatePath"),
                         candidate_sha[:12]))
    else:
        verdict["status"] = "PROVENANCE_RECONCILED"
        verdict["code"] = "OK"
        verdict["nextStage"] = ("proceed to the mandatory artifact "
                                "validator / installed / tenant / "
                                "stakeholder gates; this scoped check does "
                                "not make GA green")
    return verdict


def fingerprint_of(verdict):
    basis = {"candidate": verdict["candidate"], "lanes": verdict["lanes"],
             "manifest": verdict["manifest"], "worktree": verdict["worktree"],
             "worktreeScan": verdict.get("worktreeScan"),
             "pointerConsistency": verdict.get("pointerConsistency"),
             "code": verdict["code"]}
    return hashlib.sha256(
        json.dumps(basis, sort_keys=True).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------- modes

def cmd_arm(args):
    repo = os.path.realpath(args.repo)
    budget = Budget()
    if not os.path.isdir(repo):
        raise GateError("repo-invalid")
    git_common_dir(repo, budget)  # must be a git checkout
    if not SESSION_RE.fullmatch(args.session or ""):
        raise GateError("session-invalid")
    if not valid_ref(args.candidate):
        raise GateError("candidate-ref-invalid")
    resolve_commit(repo, args.candidate, budget)  # must exist now
    if not args.lane or len(args.lane) > MAX_LANES:
        raise GateError("need-1-to-%d-reviewed-lanes" % MAX_LANES)
    if not valid_relpath(args.manifest):
        raise GateError("manifest-path-invalid")
    if args.candidate_state is not None \
            and not valid_relpath(args.candidate_state):
        raise GateError("candidate-state-path-invalid")
    lanes = []
    for card, base_ref, head_ref in args.lane:
        if not CARD_RE.fullmatch(card):
            raise GateError("lane-card-invalid")
        base_sha = resolve_commit(repo, base_ref, budget)
        head_sha = resolve_commit(repo, head_ref, budget)
        if base_sha == head_sha:
            raise GateError("lane-empty")
        lanes.append({"card": card, "baseSha": base_sha, "headSha": head_sha})
    candidate_sha_at_arm = resolve_commit(repo, args.candidate, budget)
    sdir = session_dir(repo, args.session)
    write_private(os.path.join(sdir, "contract.json"), {
        "version": 1, "armed": True, "session": args.session,
        "candidateRef": args.candidate, "lanes": lanes,
        "manifestPath": args.manifest,
        "candidateShaAtArm": candidate_sha_at_arm,
        "worktreesAtArm": snapshot_worktrees(repo, budget),
        "candidateStatePath": args.candidate_state})
    attempts = os.path.join(sdir, "attempts.json")
    if os.path.exists(attempts):
        os.unlink(attempts)  # explicit re-arm resets continuation counters
    print("%s: armed session %s with %d reviewed lane(s) against candidate "
          "'%s'.\nThis records supplied independent approval (base/head SHAs "
          "frozen at registration); it does not itself approve code, and it "
          "is an execution/evidence contract, not a board or product plan.\n"
          "Register lanes at dispatch/review handoff with:\n"
          "  python3 scripts/ga-continuation-gate.py arm --repo %s --session "
          "%s --candidate %s --manifest %s --lane CARD BASE_SHA "
          "REVIEWED_HEAD_SHA [--lane ...]"
          % (GATE, args.session, len(lanes), args.candidate, repo,
             args.session, args.candidate, args.manifest))
    return 0


def cmd_disarm(args):
    repo = os.path.realpath(args.repo)
    sdir = session_dir(repo, args.session)
    contract = os.path.join(sdir, "contract.json")
    if os.path.exists(contract):
        write_private(contract, {"version": 1, "armed": False,
                                 "session": args.session})
        print("%s: disarmed session %s (only this session)." % (
            GATE, args.session))
    else:
        print("%s: session %s was not armed; nothing to disarm." % (
            GATE, args.session))
    attempts = os.path.join(sdir, "attempts.json")
    if os.path.exists(attempts):
        os.unlink(attempts)
    return 0


def cmd_check(args):
    repo = os.path.realpath(args.repo)
    # sanitize before any diagnostics: never echo an invalid session string
    session = args.session if (isinstance(args.session, str)
                               and SESSION_RE.fullmatch(args.session)) \
        else "<invalid-session>"
    try:
        contract = load_contract(repo, args.session)
    except GateError as exc:
        print(json.dumps({"gate": GATE, "session": session,
                          "status": "BLOCKED", "code": "BLOCKED_CONTRACT",
                          "error": exc.code, "scope": SCOPE_NOTE},
                         sort_keys=True))
        return 3
    if contract is None:
        print(json.dumps({"gate": GATE, "session": session,
                          "status": "UNARMED", "code": "UNARMED",
                          "scope": SCOPE_NOTE}, sort_keys=True))
        return 2
    verdict = run_check(repo, session, contract)
    verdict["fingerprint"] = fingerprint_of(verdict)
    print(json.dumps(verdict, sort_keys=True))
    return {"PROVENANCE_RECONCILED": 0, "NOT_READY": 2}.get(
        verdict["status"], 3)


def _emit(obj):
    print(json.dumps(obj, sort_keys=True))
    return 0


def _hook_fail_output(repo, session, verdict, stop_hook_active):
    """Attempt-bounded block / STALLED output; never a silent pass."""
    fingerprint = fingerprint_of(verdict)
    sdir = session_dir(repo, session)
    attempts_path = os.path.join(sdir, "attempts.json")
    try:
        prev = read_private(attempts_path) or {}
    except GateError:
        prev = {}
    if stop_hook_active and prev.get("fingerprint") == fingerprint \
            and isinstance(prev.get("blocks"), int) and prev["blocks"] > 0:
        blocks = prev["blocks"] + 1
    else:
        blocks = 1  # new operator turn or changed evidence resets attempts
    try:
        write_private(attempts_path, {"fingerprint": fingerprint,
                                      "blocks": blocks})
    except GateError:
        return _emit({"continue": False, "stopReason": (
            "%s STALLED: GA RED, work is NOT complete. Cannot persist the "
            "continuation counter; repair private state storage before "
            "resuming. This stop is not a pass." % GATE)})
    check_cmd = shlex.join(["python3", os.path.abspath(__file__), "check",
                            "--repo", repo, "--session", session])
    stage = verdict.get("nextStage") or "inspect the gate verdict"
    if blocks <= MAX_BLOCK_ATTEMPTS:
        reason = (
            "%s: GA remains RED; registered reviewed work is not reconciled "
            "with the candidate (%s). Resume the earliest unmet registered "
            "stage now — %s — using the ga-sprint-driver skill. Do not "
            "re-probe unrelated authentication. Inspect the receipt: %s "
            "(receipt at .claude/ga-continuation/%s/receipt.json). %s"
            % (GATE, verdict.get("code"), stage, check_cmd, session,
               SCOPE_NOTE))
        return _emit({"decision": "block",
                      "reason": reason[:MAX_REASON_CHARS]})
    stop_reason = (
        "%s STALLED: GA RED, work is NOT complete and this stop is not a "
        "pass. %d corrective continuations produced identical failed "
        "evidence (%s; stage: %s). Operator action needed: run %s to "
        "inspect and correct the stage via ga-sprint-driver. Disarming is "
        "only for completed/cancelled work or an explicit ownership transfer."
        % (GATE, MAX_BLOCK_ATTEMPTS, verdict.get("code"), stage, check_cmd))
    return _emit({"continue": False,
                  "stopReason": stop_reason[:MAX_REASON_CHARS]})


def _hook_fail_output_safe(repo, session, verdict, stop_hook_active):
    try:
        return _hook_fail_output(repo, session, verdict, stop_hook_active)
    except Exception:
        return _emit({"decision": "block",
                      "reason": "%s: gate error (%s); GA remains RED, this "
                                "stop is not a completion." %
                                (GATE, verdict.get("code"))})


def cmd_hook(args):
    repo = os.path.realpath(args.repo)
    # Parse and attribute the event before anything else; unattributable or
    # foreign events are inert ({}), so other sessions are never affected.
    try:
        raw = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
        if len(raw) > MAX_STDIN_BYTES:
            return _emit({})
        event = json.loads(raw.decode("utf-8"))
    except Exception:
        return _emit({})
    if not isinstance(event, dict):
        return _emit({})
    if event.get("hook_event_name") not in (None, "Stop"):
        return _emit({})
    if event.get("is_interrupt"):
        return _emit({})  # respect a signaled user interrupt
    session = event.get("session_id")
    cwd = event.get("cwd")
    if not (isinstance(session, str) and SESSION_RE.fullmatch(session)
            and isinstance(cwd, str) and os.path.isdir(cwd)):
        return _emit({})
    # Configuration errors must not affect sessions that never armed this gate.
    if not os.path.lexists(os.path.join(session_dir(repo, session), "contract.json")):
        return _emit({})
    budget = Budget()
    stop_hook_active = event.get("stop_hook_active") is True
    try:
        repo_common = git_common_dir(repo, budget)
    except GateError:
        # Enabled gate with an unusable --repo is misconfiguration:
        # fail closed rather than silently passing.
        verdict = {"gate": GATE, "session": session, "status": "BLOCKED",
                   "code": "BLOCKED_REPO_CONFIG", "candidate": None,
                   "lanes": [], "manifest": None, "worktree": None,
                   "nextStage": ("repair the gate configuration: --repo "
                                 "must point at the controlling git "
                                 "checkout"), "scope": SCOPE_NOTE}
        return _hook_fail_output_safe(repo, session, verdict,
                                      stop_hook_active)
    try:
        if git_common_dir(cwd, budget) != repo_common:
            return _emit({})  # different repo: not ours
    except GateError:
        return _emit({})  # cwd not a usable git checkout: inert

    try:
        contract = load_contract(repo, session)
    except GateError:
        # Enabled but malformed contract: BLOCKED, never a pass.
        verdict = {"gate": GATE, "session": session, "status": "BLOCKED",
                   "code": "BLOCKED_CONTRACT", "candidate": None,
                   "lanes": [], "manifest": None, "worktree": None,
                   "nextStage": ("repair the gate contract: re-arm with "
                                 "explicit reviewed lanes or disarm this "
                                 "session"), "scope": SCOPE_NOTE}
        return _hook_fail_output_safe(repo, session, verdict, stop_hook_active)
    if contract is None:
        return _emit({})  # not armed for this session: inert

    try:
        verdict = run_check(repo, session, contract)
        fingerprint = fingerprint_of(verdict)
        receipt_ok = True
        try:
            write_private(
                os.path.join(session_dir(repo, session), "receipt.json"),
                {"verdict": verdict, "fingerprint": fingerprint,
                 "stopHookActive": stop_hook_active,
                 "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
        except Exception:
            receipt_ok = False  # a pass requires its receipt
        if verdict["status"] == "PROVENANCE_RECONCILED" and not receipt_ok:
            verdict = dict(verdict, status="BLOCKED",
                           code="BLOCKED_RECEIPT",
                           nextStage=("gate could not persist its required "
                                      "receipt under .claude/ga-continuation"
                                      "; fix state-dir permissions"))
            return _hook_fail_output_safe(repo, session, verdict,
                                          stop_hook_active)
        if verdict["status"] == "PROVENANCE_RECONCILED":
            _emit({"systemMessage": (
                "%s: scoped provenance check PROVENANCE_RECONCILED for the "
                "registered lanes at candidate %s. This is not a GA verdict; "
                "artifact/installed/tenant/stakeholder gates still apply."
                % (GATE, verdict["candidate"]["sha"][:12]))})
            return 0
        return _hook_fail_output(repo, session, verdict, stop_hook_active)
    except Exception:
        # No silent pass on internal failure for an armed session.
        verdict = {"gate": GATE, "session": session, "status": "BLOCKED",
                   "code": "BLOCKED_GATE_ERROR", "candidate": None,
                   "lanes": [], "manifest": None, "worktree": None,
                   "nextStage": ("gate self-check failed; run the check "
                                 "command to inspect"), "scope": SCOPE_NOTE}
        return _hook_fail_output_safe(repo, session, verdict, stop_hook_active)


def build_parser():
    parser = argparse.ArgumentParser(prog=GATE, description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)

    arm = sub.add_parser("arm", help="register a per-session evidence "
                         "contract (records supplied independent approval; "
                         "does not approve code)")
    arm.add_argument("--repo", required=True,
                     help="canonical controlling checkout")
    arm.add_argument("--session", required=True, help="session UUID")
    arm.add_argument("--candidate", required=True,
                     help="dynamic candidate ref (branch or SHA)")
    arm.add_argument("--lane", nargs=3, action="append",
                     metavar=("CARD", "BASE_SHA", "REVIEWED_HEAD_SHA"),
                     help="reviewed lane; repeatable; >=1 required")
    arm.add_argument("--manifest", required=True,
                     help="repo-relative release manifest path")
    arm.add_argument("--candidate-state", default=None,
                     help="optional repo-relative maintained source-pointer "
                          "JSON (e.g. docs/completion-state.json); absent "
                          "=> pointerConsistency NOT_CONFIGURED")

    for name in ("check", "disarm"):
        p = sub.add_parser(name)
        p.add_argument("--repo", required=True)
        p.add_argument("--session", required=True)

    hook = sub.add_parser("hook", help="Stop hook entrypoint (stdin JSON)")
    hook.add_argument("--repo", required=True,
                      help="canonical controlling checkout (fixed in "
                           "settings)")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    handler = {"arm": cmd_arm, "check": cmd_check,
               "disarm": cmd_disarm, "hook": cmd_hook}[args.mode]
    try:
        return handler(args)
    except GateError as exc:
        if args.mode == "hook":
            # unreachable in practice (hook handles its own errors), but
            # never let an exception look like a pass
            print(json.dumps({"decision": "block",
                              "reason": "%s: gate error (%s); GA remains "
                                        "RED" % (GATE, exc.code)}))
            return 0
        print("%s: error: %s" % (GATE, exc.code), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
