"""Unit tests for scripts/claude-runner.py using the deterministic fake CLI.

Every scenario uses small configurable intervals so the whole suite stays
well under 15 seconds. Run: python3 -m unittest tests.ops.test_claude_runner -v
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RUNNER = os.path.join(REPO, "scripts", "claude-runner.py")
FAKE = os.path.join(HERE, "fake_claude.py")
FAST = ["--poll-seconds", "0.05", "--quiet-warning-seconds", "0.3", "--grace-seconds", "0.3"]


class ClaudeRunnerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.chmod(FAKE, 0o755)
        # Warm interpreter/shebang caches so deadline tests do not race a slow
        # first spawn (observed >1s cold start killing the fake before its
        # SIGINT handler was installed).
        subprocess.run([FAKE], input=b"", env=dict(os.environ, FAKE_MODE="noresult"),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.join(self.tmp.name, "runs")
        self.prompt = os.path.join(self.tmp.name, "prompt.txt")
        with open(self.prompt, "w") as f:
            f.write("PROMPT_MARKER do the task\n")

    def start(self, mode, task, extra_args=(), extra_env=None):
        env = dict(os.environ, FAKE_MODE=mode, ANTHROPIC_API_KEY="dummy-must-be-removed")
        env.update(extra_env or {})
        cmd = [sys.executable, RUNNER, "run", "--task", task, "--prompt", self.prompt,
               "--output-root", self.root, "--claude-bin", FAKE, *FAST, *extra_args]
        return subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)

    def finish(self, proc, timeout=10):
        out, err = proc.communicate(timeout=timeout)
        return proc.returncode, out, err

    def read_status(self, task):
        with open(os.path.join(self.root, task, "status.json")) as f:
            return json.load(f)

    def wait_status(self, task, predicate, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                status = self.read_status(task)
                if predicate(status):
                    return status
            except (OSError, ValueError):
                pass
            time.sleep(0.02)
        self.fail("status predicate not met within %ss for %s" % (timeout, task))

    def test_normal_success_env_args_and_permissions(self):
        probe = os.path.join(self.tmp.name, "probe.json")
        proc = self.start("success", "t-success", ["--session-id",
                          "11111111-1111-4111-8111-111111111111", "--budget-usd", "2.5"],
                          {"FAKE_PROBE": probe})
        code, out, _ = self.finish(proc)
        self.assertEqual(code, 0)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "CLI_SUCCEEDED")
        self.assertEqual(final["validation"], "PENDING_INDEPENDENT_REVIEW")
        self.assertEqual(final["toolCalls"], 2)
        self.assertEqual(final["observedModel"], "claude-fable-5")
        self.assertFalse(final["modelMismatch"])
        self.assertEqual(final["observedProviders"], ["bedrock"])
        self.assertFalse(final["providerMismatch"])
        self.assertEqual(final["providerEvidence"], "result-usage")
        self.assertEqual(final["sessionId"], "11111111-1111-4111-8111-111111111111")
        self.assertEqual(final["estimatedCostUsd"], 0.0123)
        with open(probe) as f:
            seen = json.load(f)
        self.assertEqual(seen["banned_present"], [])
        self.assertEqual(seen["aws_profile"], "bedrock")
        self.assertEqual(seen["aws_region"], "us-east-2")
        self.assertEqual(seen["use_bedrock"], "1")
        argv = seen["argv"]
        for flag in ("-p", "--bare", "--session-id", "--output-format",
                     "--include-partial-messages", "--max-budget-usd"):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index("--model") + 1], "claude-fable-5")
        task_dir = os.path.join(self.root, "t-success")
        self.assertEqual(stat.S_IMODE(os.stat(task_dir).st_mode), 0o700)
        for name in ("status.json", "stream.jsonl", "receipt.json", "result.json"):
            self.assertEqual(stat.S_IMODE(os.stat(os.path.join(task_dir, name)).st_mode),
                             0o600, name)
        with open(os.path.join(task_dir, "status.json")) as f:
            raw = f.read()
        self.assertNotIn("SECRET_CONTENT_MARKER", raw)  # no content in status
        self.assertNotIn("PROMPT_MARKER", raw)
        with open(os.path.join(task_dir, "result.json")) as f:
            self.assertIn("SECRET_CONTENT_MARKER", f.read())  # receipt of real result kept

    def test_silent_but_live_sets_quiet_warning_without_kill(self):
        proc = self.start("quiet", "t-quiet", extra_env={"FAKE_SLEEP": "1.2"})
        mid = self.wait_status("t-quiet", lambda s: s.get("quietWarning"))
        self.assertTrue(mid["processAlive"])
        self.assertEqual(mid["phase"], "RUNNING")
        self.assertEqual(mid["terminationStage"], "none")
        code, out, _ = self.finish(proc)
        self.assertEqual(code, 0)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "CLI_SUCCEEDED")  # warned, never killed

    def test_contrary_provider_evidence_fails_closed(self):
        code, out, _ = self.finish(self.start("wrongprovider", "t-provider"))
        self.assertEqual(code, 1)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "PROVIDER_MISMATCH")
        self.assertTrue(final["providerMismatch"])
        self.assertEqual(final["observedProviders"], ["anthropic"])
        self.assertEqual(final["providerEvidence"], "result-usage")

    def test_contrary_canonical_model_in_usage_fails_closed(self):
        code, out, _ = self.finish(self.start("wrongcanonical", "t-canonical"))
        self.assertEqual(code, 1)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "MODEL_MISMATCH")
        self.assertTrue(final["modelMismatch"])

    def test_error_subtype_cannot_pass_with_false_error_flag(self):
        code, out, _ = self.finish(self.start("contradictoryerror", "t-error-subtype"))
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.strip())["phase"], "CLI_FAILED")

    def test_absent_provider_evidence_stays_honest(self):
        code, out, _ = self.finish(self.start("nousage", "t-nousage"))
        self.assertEqual(code, 0)  # env pin holds; absence is not a mismatch
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "CLI_SUCCEEDED")
        self.assertFalse(final["providerMismatch"])
        self.assertEqual(final["observedProviders"], [])
        self.assertEqual(final["providerEvidence"], "env-pinned-unobserved")

    def test_spawn_failure_writes_structured_receipt(self):
        proc = self.start("success", "t-spawnfail", ["--claude-bin", "/nonexistent/claude"])
        code, out, err = self.finish(proc)
        self.assertEqual(code, 1)
        self.assertNotIn("Traceback", err)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "SPAWN_FAILED")
        self.assertIn("FileNotFoundError", final["spawnError"])
        status = self.read_status("t-spawnfail")
        self.assertEqual(status["phase"], "SPAWN_FAILED")
        self.assertFalse(status["processAlive"])
        receipt_path = os.path.join(self.root, "t-spawnfail", "receipt.json")
        with open(receipt_path) as f:
            self.assertEqual(json.load(f)["finalStatus"]["phase"], "SPAWN_FAILED")

    def test_vetted_tools_flags_passthrough_including_empty(self):
        probe = os.path.join(self.tmp.name, "probe-tools.json")
        code, _, _ = self.finish(self.start(
            "success", "t-tools", ["--tools", "", "--allowed-tools", "Read"],
            {"FAKE_PROBE": probe}))
        self.assertEqual(code, 0)
        with open(probe) as f:
            argv = json.load(f)["argv"]
        self.assertEqual(argv[argv.index("--tools") + 1], "")
        self.assertEqual(argv[argv.index("--allowedTools") + 1], "Read")

    def test_exit_zero_without_result_is_not_a_pass(self):
        code, out, _ = self.finish(self.start("noresult", "t-noresult"))
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.strip())["phase"], "EXIT_WITHOUT_RESULT")

    def test_malformed_result_is_not_a_pass(self):
        code, out, _ = self.finish(self.start("badresult", "t-badresult"))
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.strip())["phase"], "MALFORMED_RESULT")

    def test_is_error_result_fails(self):
        code, out, _ = self.finish(self.start("iserror", "t-iserror"))
        self.assertEqual(code, 1)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "CLI_FAILED")
        self.assertTrue(final["isError"])

    def test_model_mismatch_is_not_a_pass(self):
        code, out, _ = self.finish(self.start("mismatch", "t-mismatch"))
        self.assertEqual(code, 1)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "MODEL_MISMATCH")
        self.assertTrue(final["modelMismatch"])
        self.assertEqual(final["observedModel"], "other-model")

    def test_deadline_escalates_and_keeps_partial_output(self):
        proc = self.start("hang", "t-deadline", ["--deadline-seconds", "2.0"])
        code, out, _ = self.finish(proc)
        self.assertEqual(code, 1)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "TIMED_OUT")
        self.assertIn(final["terminationStage"], ("SIGTERM", "SIGKILL"), final)  # SIGINT ignored
        task_dir = os.path.join(self.root, "t-deadline")
        with open(os.path.join(task_dir, "stream.jsonl")) as f:
            self.assertIn('"init"', f.read())  # partial output preserved
        self.assertTrue(os.path.exists(os.path.join(task_dir, "receipt.json")))

    def test_deadline_kills_whole_owned_process_tree(self):
        pid_file = os.path.join(self.tmp.name, "child.pid")
        proc = self.start("tree", "t-tree", ["--deadline-seconds", "2.0"],
                          {"FAKE_CHILD_PID_FILE": pid_file})
        code, out, _ = self.finish(proc)
        self.assertEqual(json.loads(out.strip())["phase"], "TIMED_OUT")
        with open(pid_file) as f:
            child_pid = int(f.read())
        for _ in range(50):  # allow signal delivery/reap
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.05)
        os.kill(child_pid, 9)  # cleanup before failing
        self.fail("grandchild %d survived process-group termination" % child_pid)

    def test_partial_json_lines_are_reassembled(self):
        proc = self.start("partial", "t-partial", extra_env={"FAKE_SLEEP": "0.4"})
        code, out, _ = self.finish(proc)
        self.assertEqual(code, 0)
        final = json.loads(out.strip())
        self.assertEqual(final["phase"], "CLI_SUCCEEDED")
        self.assertEqual(final["toolCalls"], 1)  # split line counted exactly once
        self.assertEqual(final["eventCount"], 3)  # init + assistant + result

    def test_result_before_exit_visible_while_alive(self):
        proc = self.start("resultbeforeexit", "t-rbe", extra_env={"FAKE_SLEEP": "0.8"})
        mid = self.wait_status("t-rbe", lambda s: s.get("resultReceived") and s.get("processAlive"))
        self.assertEqual(mid["phase"], "RUNNING")
        code, out, _ = self.finish(proc)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.strip())["phase"], "CLI_SUCCEEDED")

    def test_status_command_is_attachless(self):
        code, _, _ = self.finish(self.start("success", "t-status"))
        self.assertEqual(code, 0)
        out = subprocess.run(
            [sys.executable, RUNNER, "status", "--task", "t-status", "--output-root", self.root],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(out.returncode, 0)
        status = json.loads(out.stdout)
        self.assertEqual(status["phase"], "CLI_SUCCEEDED")
        self.assertIn("heartbeatAt", status)
        self.assertIn("lastChildActivityAt", status)


if __name__ == "__main__":
    unittest.main()
