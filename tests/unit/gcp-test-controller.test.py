#!/usr/bin/env python3
"""Behavioral stdlib tests for windows-pilot/vm-testing/gcp-test-controller.py
(CLWX-25). Every test runs the real CLI as a subprocess with fake `gcloud`
and `ssh` executables first on PATH. The fakes log every argv (and selected
env facts) they receive and answer from a per-test scenario file; the IAP
REST path is served by a local stdlib HTTP server. Assertions target
observable behavior — exit codes, which subprocesses ran (or provably did
not), receipts, locks and redaction — not string mirrors of the source.

Run: python3 tests/unit/gcp-test-controller.test.py
"""
import http.server
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CLI = os.path.join(REPO, "windows-pilot", "vm-testing", "gcp-test-controller.py")
EXAMPLE = os.path.join(REPO, "windows-pilot", "vm-testing",
                       "controller-config.example.json")
PY = sys.executable or "python3"
FAKE_TOKEN = "ya29.FAKE-TEST-TOKEN-MUST-NEVER-APPEAR"

# Fake gcloud: logs argv + env facts, answers from scenario rules. A rule may
# also "listen" (bind a local SSH-banner socket, emulating start-iap-tunnel)
# or "sleep". Unmatched argv exits 97 so unexpected calls fail loudly.
FAKE_GCLOUD = r'''
import json, os, socket, sys, time
args = sys.argv[1:]
POISON = ("CLOUDSDK_CORE_ACCOUNT", "CLOUDSDK_AUTH_ACCESS_TOKEN",
          "CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT",
          "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_OAUTH_ACCESS_TOKEN",
          "SSH_AUTH_SOCK")
entry = {"argv": args,
         "cloudsdkConfig": os.environ.get("CLOUDSDK_CONFIG"),
         "poisonVars": [k for k in POISON if k in os.environ]}
for a in args:
    if a.startswith("--metadata-from-file=ssh-keys="):
        entry["sshKeysFile"] = open(a.split("=", 2)[2]).read()
with open(os.environ["FAKE_LOG"], "a") as fh:
    fh.write(json.dumps(entry) + "\n")
joined = " ".join(args)
for idx, rule in enumerate(json.load(open(os.environ["FAKE_SCENARIO"]))):
    if all(tok in joined for tok in rule["match"]):
        if "sequence" in rule:  # different answers for repeated identical argv
            state_path = os.environ["FAKE_LOG"] + ".state"
            state = json.load(open(state_path)) if os.path.exists(state_path) else {}
            n = state.get(str(idx), 0)
            state[str(idx)] = n + 1
            with open(state_path, "w") as fh:
                json.dump(state, fh)
            rule = rule["sequence"][min(n, len(rule["sequence"]) - 1)]
        if rule.get("listen") or rule.get("listenDeny"):
            port = int([a for a in args if a.startswith("--local-host-port=")][0].split(":")[1])
            srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind(("127.0.0.1", port)); srv.listen(4)
            end = time.time() + 20
            srv.settimeout(0.5)
            while time.time() < end:
                try:
                    conn, _ = srv.accept()
                    if rule.get("listenDeny"):
                        # local listener accepted a connection but NO remote
                        # data ever flows; the tunnel then reports the denial
                        conn.close(); srv.close()
                        sys.stdout.write(rule["listenDeny"]); sys.stdout.flush()
                        sys.exit(1)
                    conn.sendall(b"SSH-2.0-FAKE_TUNNELED_GUEST\r\n"); conn.close()
                except socket.timeout:
                    pass
            sys.exit(0)
        time.sleep(rule.get("sleep", 0))
        sys.stdout.write(rule.get("stdout", ""))
        sys.stderr.write(rule.get("stderr", ""))
        sys.exit(rule.get("exitCode", 0))
sys.stderr.write("fake gcloud: no rule matched: " + joined)
sys.exit(97)
'''

FAKE_SSH = r'''
import json, os, sys, time
with open(os.environ["FAKE_LOG"], "a") as fh:
    fh.write(json.dumps({"argv": ["ssh"] + sys.argv[1:],
                         "sawSshAuthSock": "SSH_AUTH_SOCK" in os.environ}) + "\n")
rule = json.load(open(os.environ["FAKE_SSH_SCENARIO"]))
time.sleep(rule.get("sleep", 0))
sys.stdout.write(rule.get("stdout", ""))
sys.stderr.write(rule.get("stderr", ""))
sys.exit(rule.get("exitCode", 0))
'''

IMG = {"name": "debian-12-test-v20260101", "project": "debian-cloud",
       "id": "5555555555555555555"}
TARGET = {"name": "clawx-lab-fake-target", "zone": "us-central1-a",
          "instanceId": "4908385059495321872", "sshUsername": "clawxlab"}
SA_EMAIL = "clawx-test-controller@gen-lang-client-test.iam.gserviceaccount.com"


class IapHandler(http.server.BaseHTTPRequestHandler):
    calls = []
    policy = {"etag": "ETAG-1", "bindings": [
        {"role": "roles/compute.viewer", "members": ["user:someone@example.com"]}],
        "auditConfigs": [{"service": "iap.googleapis.com",
                          "auditLogConfigs": [{"logType": "ADMIN_READ"}]}]}
    conflict = False

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        IapHandler.calls.append({"path": self.path, "body": body,
                                 "auth": self.headers.get("Authorization")})
        if self.path.endswith(":getIamPolicy"):
            policy = json.loads(json.dumps(IapHandler.policy))
            if IapHandler.conflict:
                policy["bindings"].append({
                    "role": "roles/iap.tunnelResourceAccessor",
                    "members": [f"serviceAccount:{SA_EMAIL}"],
                    "condition": {"expression": "destination.port == 3389",
                                  "title": "wrong"}})
            elif any(c["path"].endswith(":setIamPolicy") for c in IapHandler.calls):
                policy = IapHandler.calls[-2]["body"]["policy"]
            out = json.dumps(policy).encode()
        elif self.path.endswith(":setIamPolicy"):
            out = json.dumps(body["policy"]).encode()
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def happy_rules(controller="clawx-controller-t1", fw="clawx-controller-t1-fw"):
    return [
        {"match": ["images", "describe"], "stdout": json.dumps(IMG)},
        {"match": ["subnets", "describe"],
         "stdout": json.dumps({"name": "clawx-test-lab-us-central1",
                               "network": "projects/p/global/networks/clawx-test-lab"})},
        {"match": ["networks", "describe"],
         "stdout": json.dumps({"name": "clawx-test-lab", "autoCreateSubnetworks": False})},
        {"match": ["instances", "describe", TARGET["name"]],
         "stdout": json.dumps({"id": TARGET["instanceId"], "status": "RUNNING"})},
        {"match": ["service-accounts", "list"], "stdout": "[]"},
        {"match": ["service-accounts", "create"], "stdout": "{}"},
        {"match": ["service-accounts", "describe"],
         "stdout": json.dumps({"email": SA_EMAIL, "disabled": False, "uniqueId": "111"})},
        {"match": ["roles", "describe"], "sequence": [
            {"exitCode": 1, "stderr": "ERROR: NOT_FOUND: role does not exist"},
            {"stdout": json.dumps({
                "name": "projects/gen-lang-client-test/roles/clawxTestDiscovery",
                "includedPermissions": ["compute.instances.get",
                                        "compute.instances.list"]})}]},
        {"match": ["roles", "create"], "stdout": "{}"},
        {"match": ["add-iam-policy-binding"],
         "stdout": json.dumps({"bindings": [
             {"role": "projects/gen-lang-client-test/roles/clawxTestDiscovery",
              "members": [f"serviceAccount:{SA_EMAIL}"]}]})},
        {"match": ["auth", "print-access-token"], "stdout": FAKE_TOKEN + "\n"},
        {"match": ["firewall-rules", "list"], "sequence": [
            {"stdout": "[]"},  # conflicts preflight: absent
            {"stdout": json.dumps([{  # post-create readback: exact rule
                "name": fw, "allowed": [{"IPProtocol": "tcp", "ports": ["22"]}],
                "sourceRanges": ["35.235.240.0/20"],
                "targetTags": ["clawx-test-controller"]}])}]},
        {"match": ["firewall-rules", "create"], "stdout": "{}"},
        {"match": ["instances", "list"], "stdout": "[]"},
        {"match": ["instances", "create"], "stdout": json.dumps([
            {"id": "9090909090909090909", "name": controller, "status": "RUNNING",
             "serviceAccounts": [{"email": SA_EMAIL}],
             "networkInterfaces": [{"accessConfigs": [{"natIP": "203.0.113.9"}]}]}])},
    ]


class Env:
    def __init__(self, test, rules=None, ssh_rule=None, iap_port=None,
                 config_mut=None, roleDescribeAfterCreate=None):
        self.dir = tempfile.mkdtemp(prefix="clawx-ctl-test-")
        test.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        bindir = os.path.join(self.dir, "bin")
        os.makedirs(bindir)
        for name, src, arg0 in (("gcloud", FAKE_GCLOUD, "FAKE_GCLOUD"),
                                ("ssh", FAKE_SSH, "FAKE_SSH")):
            driver = os.path.join(self.dir, f"driver-{name}.py")
            with open(driver, "w") as fh:
                fh.write(src)
            path = os.path.join(bindir, name)
            with open(path, "w") as fh:
                fh.write(f"#!/bin/sh\nexec {PY} {driver} \"$@\"\n")
            os.chmod(path, 0o755)
        self.log = os.path.join(self.dir, "calls.log")
        self.scenario = os.path.join(self.dir, "scenario.json")
        self.ssh_scenario = os.path.join(self.dir, "ssh-scenario.json")
        with open(self.scenario, "w") as fh:
            json.dump(rules or [], fh)
        with open(self.ssh_scenario, "w") as fh:
            json.dump(ssh_rule or {"stdout": "CLAWX_CONTROLLER_ACCESS_OK\n"}, fh)
        cfg = json.load(open(EXAMPLE))
        cfg.update({"project": "gen-lang-client-test", "projectNumber": "622687731621"})
        cfg["controller"].update({
            "name": "clawx-controller-t1", "operatorUsername": "operator",
            "operatorSshPublicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE op@mac",
            "firewallName": "clawx-controller-t1-fw", "image": dict(IMG)})
        cfg["serviceAccount"]["id"] = "clawx-test-controller"
        cfg["discoveryRole"]["id"] = "clawxTestDiscovery"
        cfg["targets"] = [dict(TARGET)]
        key = os.path.join(self.dir, "guest-key")
        kh = os.path.join(self.dir, "known_hosts")
        for p in (key, kh):
            with open(p, "w") as fh:
                fh.write("x\n")
        cfg["probe"].update({"privateKeyPath": key, "knownHostsPath": kh,
                             "tunnelWaitSeconds": 8, "authTimeoutSeconds": 8})
        if iap_port:
            cfg["iapApiBase"] = f"http://127.0.0.1:{iap_port}/v1"
        if config_mut:
            config_mut(cfg)
        self.config = os.path.join(self.dir, "config.json")
        with open(self.config, "w") as fh:
            json.dump(cfg, fh, indent=2)
        self.receipts = os.path.join(self.dir, "receipts")
        self.iap_base = cfg.get("iapApiBase")

    def run(self, *args, extra_env=None):
        env = {**os.environ,
               "PATH": os.path.join(self.dir, "bin") + os.pathsep + os.environ["PATH"],
               "FAKE_LOG": self.log, "FAKE_SCENARIO": self.scenario,
               "FAKE_SSH_SCENARIO": self.ssh_scenario,
               "CLOUDSDK_CONFIG": os.path.join(self.dir, "cloudsdk"),
               "GOOGLE_APPLICATION_CREDENTIALS": os.path.join(self.dir, "adc.json")}
        if self.iap_base:
            env["CLAWX_CONTROLLER_TEST_IAP_BASE"] = self.iap_base
        env.update(extra_env or {})
        return subprocess.run([PY, CLI, *args, "--config", self.config],
                              capture_output=True, text=True, timeout=120, env=env)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as fh:
            return [json.loads(l) for l in fh if l.strip()]


def boot_args(env):
    return ["bootstrap", "--run-id", "t-run-1",
            "--controller", "clawx-controller-t1", "--receipt-dir", env.receipts]


def read_receipt(env, name):
    return json.load(open(os.path.join(env.receipts, name)))


class PlanTests(unittest.TestCase):
    def test_plan_is_pure_and_blocks_placeholders(self):
        env = Env(self)
        r = subprocess.run([PY, CLI, "plan", "--config", EXAMPLE],
                           capture_output=True, text=True, timeout=60,
                           env={**os.environ, "PATH": os.path.join(env.dir, "bin")
                                + os.pathsep + os.environ["PATH"],
                                "FAKE_LOG": env.log, "FAKE_SCENARIO": env.scenario})
        self.assertEqual(r.returncode, 2)
        plan = json.loads(r.stdout)
        self.assertTrue(plan["blockers"])
        self.assertFalse(plan["mutation"])
        self.assertEqual(env.calls(), [])  # not one subprocess

    def test_plan_resolved_config_pins_shape_and_no_secrets(self):
        env = Env(self)
        r = env.run("plan")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        plan = json.loads(r.stdout)
        create = plan["argv"]["controllerCreate"]
        for flag in ("--machine-type=e2-medium", "--boot-disk-size=20GB",
                     "--boot-disk-type=pd-balanced", "--scopes=cloud-platform",
                     f"--service-account={SA_EMAIL}",
                     "--metadata=block-project-ssh-keys=TRUE"):
            self.assertIn(flag, create)
        self.assertEqual(plan["iapGrants"][0]["condition"], "destination.port == 22")
        self.assertNotIn("PRIVATE", r.stdout)
        self.assertEqual(env.calls(), [])

    def test_unsafe_discovery_permissions_refused(self):
        def mut(cfg):
            cfg["discoveryRole"]["permissions"] = [
                "compute.instances.get", "compute.instances.list",
                "compute.instances.setMetadata"]
        env = Env(self, happy_rules(), config_mut=mut)
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 2)
        self.assertIn("discoveryRole.permissions", r.stderr)
        self.assertEqual(env.calls(), [])

    def test_protected_target_and_private_key_refused(self):
        def mut(cfg):
            cfg["targets"][0]["name"] = "clawx-win-rc-20260609"
            cfg["controller"]["operatorSshPublicKey"] = \
                "-----BEGIN OPENSSH PRIVATE KEY----- xyz"
        env = Env(self, happy_rules(), config_mut=mut)
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 2)
        self.assertIn("protected owner instance", r.stderr)
        self.assertIn("PUBLIC key", r.stderr)
        self.assertEqual(env.calls(), [])

    def test_injection_shaped_target_name_refused(self):
        def mut(cfg):
            cfg["targets"][0]["name"] = "vm; rm -rf /"
        env = Env(self, happy_rules(), config_mut=mut)
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 2)
        self.assertEqual(env.calls(), [])


class BootstrapTests(unittest.TestCase):
    def creates(self, env):
        return [c["argv"] for c in env.calls() if "create" in c["argv"]]

    def test_image_id_mismatch_fails_closed_before_any_create(self):
        rules = happy_rules()
        rules[0] = {"match": ["images", "describe"],
                    "stdout": json.dumps({**IMG, "id": "999"})}
        env = Env(self, rules)
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.creates(env), [])
        receipt = read_receipt(env, "bootstrap-t-run-1.receipt.json")
        self.assertEqual(receipt["result"], "FAIL")
        self.assertIn("image readback mismatch", receipt["failure"])

    def test_target_id_mismatch_fails_closed(self):
        rules = happy_rules()
        for rule in rules:
            if rule["match"][:2] == ["instances", "describe"]:
                rule["stdout"] = json.dumps({"id": "1234567890", "status": "RUNNING"})
        env = Env(self, rules)
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.creates(env), [])
        self.assertIn("numeric ID readback",
                      read_receipt(env, "bootstrap-t-run-1.receipt.json")["failure"])

    def test_existing_sa_conflict_refused_not_adopted(self):
        rules = happy_rules()
        for rule in rules:
            if rule["match"] == ["service-accounts", "list"]:
                rule["stdout"] = json.dumps([{"email": SA_EMAIL}])
        env = Env(self, rules)
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.creates(env), [])
        self.assertIn("already exists",
                      read_receipt(env, "bootstrap-t-run-1.receipt.json")["failure"])

    def test_gcloud_failure_never_becomes_pass_and_lock_is_single_use(self):
        rules = happy_rules()
        rules[1] = {"match": ["subnets", "describe"], "exitCode": 1,
                    "stderr": "ERROR: quota"}
        env = Env(self, rules)
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 1)
        again = env.run(*boot_args(env))
        self.assertEqual(again.returncode, 2)  # receipt/lock refuse replay
        self.assertIn("single-use", again.stderr + r.stderr)

    def test_happy_path_with_iap_rest_etag_and_readback(self):
        IapHandler.calls, IapHandler.conflict = [], False
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), IapHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        env = Env(self, happy_rules(), iap_port=server.server_address[1])
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        receipt = read_receipt(env, "bootstrap-t-run-1.receipt.json")
        self.assertEqual(receipt["result"], "PASS")
        stages = {s["stage"]: s for s in receipt["stages"]}
        self.assertEqual(stages["controllerInstance"]["readback"]["id"],
                         "9090909090909090909")
        # ssh public key provisioned via metadata file, exactly user:pubkey
        created = [c for c in env.calls() if "sshKeysFile" in c]
        self.assertEqual(len(created), 1)
        self.assertTrue(created[0]["sshKeysFile"].startswith("operator:ssh-ed25519 "))
        # IAP REST: 3 calls (get, set, readback get); etag + version 3 preserved
        paths = [c["path"].rsplit(":", 1)[1] for c in IapHandler.calls]
        self.assertEqual(paths, ["getIamPolicy", "setIamPolicy", "getIamPolicy"])
        set_body = IapHandler.calls[1]["body"]["policy"]
        self.assertEqual(set_body["etag"], "ETAG-1")
        self.assertEqual(set_body["version"], 3)
        self.assertEqual(set_body["auditConfigs"], IapHandler.policy["auditConfigs"])
        roles = [b["role"] for b in set_body["bindings"]]
        self.assertIn("roles/compute.viewer", roles)  # existing bindings kept
        self.assertIn("roles/iap.tunnelResourceAccessor", roles)
        iap_binding = [b for b in set_body["bindings"]
                       if b["role"] == "roles/iap.tunnelResourceAccessor"][0]
        self.assertEqual(iap_binding["condition"]["expression"],
                         "destination.port == 22")
        self.assertEqual(IapHandler.calls[0]["auth"], f"Bearer {FAKE_TOKEN}")
        # secret redaction: the token appears in no receipt or output
        blob = r.stdout + r.stderr + json.dumps(receipt)
        self.assertNotIn(FAKE_TOKEN, blob)
        # receipt is immutable
        mode = os.stat(os.path.join(env.receipts,
                                    "bootstrap-t-run-1.receipt.json")).st_mode
        self.assertFalse(mode & stat.S_IWUSR)

    def test_conflicting_iap_condition_refused_without_set(self):
        IapHandler.calls, IapHandler.conflict = [], True
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), IapHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        env = Env(self, happy_rules(), iap_port=server.server_address[1])
        r = env.run(*boot_args(env))
        self.assertEqual(r.returncode, 1)
        self.assertEqual([c["path"].rsplit(":", 1)[1] for c in IapHandler.calls],
                         ["getIamPolicy"])  # no setIamPolicy after conflict
        self.assertIn("conflicting existing IAP binding",
                      read_receipt(env, "bootstrap-t-run-1.receipt.json")["failure"])


def probe_rules(denied_stderr="ERROR: (gcloud) PERMISSION_DENIED 403 permission denied"):
    return [
        {"match": ["instances", "describe", TARGET["name"]],
         "stdout": json.dumps({"id": TARGET["instanceId"], "status": "RUNNING"})},
        {"match": ["start-iap-tunnel", TARGET["name"], " 22 "], "listen": True},
        {"match": ["start-iap-tunnel", TARGET["name"], " 3389 "],
         "exitCode": 1, "stderr": denied_stderr,
         "stdout": denied_stderr + " " + FAKE_TOKEN},
    ]


class ProbeTests(unittest.TestCase):
    def meta_base(self, email=SA_EMAIL):
        """Loopback metadata-server stub returning the attached SA email."""
        class Meta(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                assert self.headers.get("Metadata-Flavor") == "Google"
                self.send_response(200)
                self.end_headers()
                self.wfile.write(email.encode())

            def log_message(self, *a):
                pass
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Meta)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        return f"http://127.0.0.1:{srv.server_address[1]}"

    POISON_ENV = {"CLOUDSDK_CORE_ACCOUNT": "human@example.com",
                  "CLOUDSDK_AUTH_ACCESS_TOKEN": "ya29.POISONED-USER-TOKEN",
                  "CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT": "other@sa",
                  "GOOGLE_OAUTH_ACCESS_TOKEN": "ya29.POISONED-OAUTH",
                  "SSH_AUTH_SOCK": "/tmp/poisoned-agent.sock"}

    def probe(self, env, target=TARGET["name"], extra=(), meta=None):
        return env.run("probe", "--target", target,
                       "--receipt-dir", env.receipts, *extra,
                       extra_env={**self.POISON_ENV,
                                  "CLAWX_CONTROLLER_TEST_METADATA_BASE":
                                  meta or self.meta_base()})

    def receipts(self, env):
        d = os.path.join(env.receipts, "probes")
        out = []
        for f in sorted(os.listdir(d)):
            if f.endswith(".receipt.json"):
                with open(os.path.join(d, f)) as fh:
                    out.append(json.load(fh))
        return out

    def test_happy_probe_clean_env_strict_ssh_and_negative_control(self):
        env = Env(self, probe_rules())
        r = self.probe(env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        receipt = self.receipts(env)[0]
        self.assertEqual(receipt["result"], "PASS")
        checks = {c["check"]: c for c in receipt["checks"]}
        self.assertTrue(checks["sshBanner"]["banner"].startswith("SSH-2.0"))
        self.assertEqual(checks["deniedPortControl"]["outcome"], "BLOCKED_IAM")
        self.assertEqual(receipt["attachedServiceAccount"], SA_EMAIL)
        # R1: poisoned user credentials never reach controller-side
        # subprocesses; CLOUDSDK_CONFIG points at a FRESH private directory
        gcloud_calls = [c for c in env.calls() if c["argv"][0] != "ssh"]
        self.assertTrue(gcloud_calls)
        for call in gcloud_calls:
            self.assertEqual(call["poisonVars"], [], call)
            self.assertTrue(str(call["cloudsdkConfig"]).startswith(
                os.path.join(env.receipts, "gcloud-config")), call)
            self.assertNotEqual(call["cloudsdkConfig"],
                                os.path.join(env.dir, "cloudsdk"))
        # strict host-key + isolation options on the real ssh argv (R4)
        ssh_entry = [c for c in env.calls() if c["argv"][0] == "ssh"][0]
        ssh_call = ssh_entry["argv"]
        self.assertFalse(ssh_entry["sawSshAuthSock"])
        self.assertIn("StrictHostKeyChecking=yes", ssh_call)
        self.assertIn("IdentitiesOnly=yes", ssh_call)
        self.assertIn(f"HostKeyAlias={TARGET['name']}", ssh_call)
        self.assertTrue(any(a.startswith("UserKnownHostsFile=") for a in ssh_call))
        self.assertEqual(ssh_call[1:3], ["-F", "/dev/null"])
        # `--` terminates options immediately BEFORE the destination; the
        # remote command is the last argv element with no leaked prefix
        self.assertEqual(ssh_call.count("--"), 1)
        dest = f"{TARGET['sshUsername']}@127.0.0.1"
        self.assertEqual(ssh_call[ssh_call.index("--") + 1], dest)
        self.assertEqual(ssh_call[-1], "echo CLAWX_CONTROLLER_ACCESS_OK")
        self.assertEqual(ssh_call.index("--") + 2, len(ssh_call) - 1)
        # token leaked by tunnel output is redacted in the receipt
        self.assertNotIn(FAKE_TOKEN, json.dumps(receipt))
        # definite outcome released the lock
        self.assertEqual(os.listdir(os.path.join(env.receipts, "locks")), [])

    def test_unlisted_target_and_duplicate_lock_refused(self):
        env = Env(self, probe_rules())
        r = self.probe(env, target="clawx-win-rc-20260609")
        self.assertEqual(r.returncode, 2)
        self.assertIn("not in the allowlisted", r.stderr)
        locks = os.path.join(env.receipts, "locks")
        os.makedirs(locks)
        with open(os.path.join(locks, f"{TARGET['name']}.lock.json"), "w") as fh:
            fh.write("{}")
        r2 = self.probe(env)
        self.assertEqual(r2.returncode, 2)
        self.assertIn("lock already exists", r2.stderr)
        self.assertEqual([c for c in env.calls()
                          if "start-iap-tunnel" in c["argv"]], [])

    def test_occupied_local_port_refused(self):
        import socket as s
        sock = s.socket()
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        self.addCleanup(sock.close)
        env = Env(self, probe_rules())
        r = self.probe(env, extra=("--local-port", str(sock.getsockname()[1])))
        self.assertEqual(r.returncode, 1)
        receipt = self.receipts(env)[0]
        self.assertIn("occupied", receipt["failure"])
        self.assertEqual([c for c in env.calls()
                          if "start-iap-tunnel" in c["argv"]], [])

    def test_ssh_nonzero_exit_is_definite_fail_lock_released(self):
        env = Env(self, probe_rules(),
                  ssh_rule={"exitCode": 255, "stderr": "Host key verification failed."})
        r = self.probe(env)
        self.assertEqual(r.returncode, 1)
        receipt = self.receipts(env)[0]
        self.assertEqual(receipt["result"], "FAIL")
        checks = {c["check"]: c for c in receipt["checks"]}
        self.assertEqual(checks["authenticatedMarker"]["outcome"], "FAIL")
        self.assertEqual(checks["authenticatedMarker"]["exit"], 255)
        self.assertEqual(os.listdir(os.path.join(env.receipts, "locks")), [])

    def test_ssh_timeout_is_uncertain_keeps_lock_no_replay(self):
        def mut(cfg):
            cfg["probe"]["authTimeoutSeconds"] = 2
        env = Env(self, probe_rules(), ssh_rule={"sleep": 20}, config_mut=mut)
        r = self.probe(env)
        self.assertEqual(r.returncode, 1)
        receipt = self.receipts(env)[0]
        self.assertEqual(receipt["result"], "UNCERTAIN")
        self.assertTrue(json.loads(r.stdout)["lockHeld"])
        self.assertEqual(os.listdir(os.path.join(env.receipts, "locks")),
                         [f"{TARGET['name']}.lock.json"])
        # exactly one ssh attempt: an uncertain write is never replayed
        self.assertEqual(len([c for c in env.calls() if c["argv"][0] == "ssh"]), 1)

    def test_wrong_attached_sa_refused_before_any_subprocess(self):
        env = Env(self, probe_rules())
        r = self.probe(env, meta=self.meta_base("intruder@other.iam.gserviceaccount.com"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("not the expected controller identity", r.stderr)
        self.assertEqual(env.calls(), [])

    def test_metadata_unreachable_refused_off_controller(self):
        import socket as s
        with s.socket() as probe_sock:  # find a port that is provably closed
            probe_sock.bind(("127.0.0.1", 0))
            closed = probe_sock.getsockname()[1]
        env = Env(self, probe_rules())
        r = self.probe(env, meta=f"http://127.0.0.1:{closed}")
        self.assertEqual(r.returncode, 2)
        self.assertIn("metadata server unreachable", r.stderr)
        self.assertEqual(env.calls(), [])

    def test_denied_control_real_protocol_data_is_fail_open(self):
        rules = probe_rules()
        rules[2] = {"match": ["start-iap-tunnel", TARGET["name"], " 3389 "],
                    "listen": True}  # unauthorized port serves REAL protocol data
        env = Env(self, rules)
        r = self.probe(env)
        self.assertEqual(r.returncode, 1)
        receipt = self.receipts(env)[0]
        self.assertEqual(receipt["result"], "FAIL")
        checks = {c["check"]: c for c in receipt["checks"]}
        self.assertEqual(checks["deniedPortControl"]["outcome"], "FAIL_OPEN")

    def test_denied_control_listener_bind_alone_is_not_access(self):
        # R2: gcloud may bind the local listener FIRST and only report the IAM
        # denial after a real connection attempt. The bind must not be treated
        # as remote access; the explicit 403 still passes the control.
        rules = probe_rules()
        rules[2] = {"match": ["start-iap-tunnel", TARGET["name"], " 3389 "],
                    "listenDeny": "ERROR: PERMISSION_DENIED: 403 permission "
                                  "denied for tunnel resource"}
        env = Env(self, rules)
        r = self.probe(env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        checks = {c["check"]: c for c in self.receipts(env)[0]["checks"]}
        self.assertEqual(checks["deniedPortControl"]["outcome"], "BLOCKED_IAM")

    def test_backend_closed_is_inconclusive_never_a_pass(self):
        env = Env(self, probe_rules(
            denied_stderr="ERROR: failed to connect to backend. 4003"))
        r = self.probe(env)
        self.assertEqual(r.returncode, 1)  # R2: closed port proves nothing
        receipt = self.receipts(env)[0]
        self.assertEqual(receipt["result"], "FAIL")
        checks = {c["check"]: c for c in receipt["checks"]}
        self.assertEqual(checks["deniedPortControl"]["outcome"],
                         "INCONCLUSIVE_BACKEND")
        self.assertIn("does NOT prove", checks["deniedPortControl"]["detail"])


class KillOwnedTests(unittest.TestCase):
    """R3: killpg only on the exact owned child group (pgid == created pid)."""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("gtc_under_test", CLI)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.killpg_calls = []
        self.real_killpg = os.killpg

    def tearDown(self):
        os.killpg = self.real_killpg

    def test_group_leader_child_killed_via_its_own_group_only(self):
        proc = subprocess.Popen([PY, "-c", "import time; time.sleep(60)"],
                                start_new_session=True)
        def record(pgid, sig):
            self.killpg_calls.append(pgid)
            return self.real_killpg(pgid, sig)
        os.killpg = record
        self.mod.kill_owned(proc)
        self.assertIsNotNone(proc.poll())
        self.assertTrue(self.killpg_calls)
        self.assertEqual(set(self.killpg_calls), {proc.pid})

    def test_non_leader_child_never_triggers_killpg(self):
        # Same session as the test runner: pgid != child pid. killpg here
        # could kill the whole test process group — it must not be called.
        proc = subprocess.Popen([PY, "-c", "import time; time.sleep(60)"],
                                start_new_session=False)
        self.assertNotEqual(os.getpgid(proc.pid), proc.pid)
        def forbid(pgid, sig):
            self.killpg_calls.append(pgid)
            raise AssertionError("killpg must not run for a non-leader child")
        os.killpg = forbid
        self.mod.kill_owned(proc)  # safe fallback: terminate the child only
        self.assertEqual(self.killpg_calls, [])
        self.assertIsNotNone(proc.poll())


if __name__ == "__main__":
    unittest.main(verbosity=2)
