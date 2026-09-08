#!/usr/bin/env python3
"""Static tests for scripts/bedrock-history-review.py.

Synthetic secrets only. Run before extracting real session logs:

    python3 tests/ops/test_bedrock_history_review.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "bedrock-history-review.py"

_spec = importlib.util.spec_from_file_location("bhr", SCRIPT)
assert _spec and _spec.loader
bhr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bhr)


class TestRedaction(unittest.TestCase):
    """Synthetic secrets must never survive sanitization."""

    def assert_scrubbed(self, raw: str, *forbidden: str) -> str:
        out, hits = bhr.sanitize_text(raw)
        for token in forbidden:
            self.assertNotIn(token, out, f"leaked {token!r} in {out!r}")
        self.assertGreater(hits, 0, f"no redaction hit for {raw!r}")
        return out

    def test_freerdp_password_flag(self):
        out = self.assert_scrubbed(
            "xfreerdp /v:localhost:35389 /u:ClawXFresh0908 /p:Sup3rSecretPw! +clipboard",
            "Sup3rSecretPw")
        self.assertIn("/p:[REDACTED]", out)
        # Non-secret flags stay inspectable as evidence.
        self.assertIn("/v:localhost:35389", out)
        self.assertIn("/u:ClawXFresh0908", out)

    def test_freerdp_gateway_and_hash_flags(self):
        out = self.assert_scrubbed(
            "xfreerdp /gp:GwPass123 /pth:aabbccddeeff00112233445566778899",
            "GwPass123", "aabbccddeeff00112233445566778899")
        self.assertIn("/gp:[REDACTED]", out)
        self.assertIn("/pth:[REDACTED]", out)

    def test_key_value_secrets(self):
        self.assert_scrubbed('AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMIfake/K7MDENGfake+EXAMPLEKEY"',
                             "wJalrXUtnFEMIfake")
        self.assert_scrubbed("password=hunter2", "hunter2")
        self.assert_scrubbed("api_key: sk-testtesttesttest1234", "sk-testtesttesttest1234")
        self.assert_scrubbed("client_secret=abc~DEF123-fake", "abc~DEF123-fake")

    def test_bearer_and_jwt(self):
        self.assert_scrubbed("Authorization: Bearer abcdefgh12345678ijklmnop", "abcdefgh12345678ijklmnop")
        self.assert_scrubbed(
            "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r",
            "dBjftJeZ4CVPmB92K27uhbUJU1p1r")

    def test_aws_access_key_id(self):
        out = self.assert_scrubbed("using AKIAIOSFODNN7EXAMPLE now", "AKIAIOSFODNN7EXAMPLE")
        self.assertIn("[REDACTED_AWS_KEY]", out)

    def test_signed_urls(self):
        self.assert_scrubbed(
            "download https://storage.example.com/build.exe?X-Amz-Signature=deadbeefcafe1234&X-Amz-Expires=900",
            "deadbeefcafe1234")
        self.assert_scrubbed(
            "form https://forms.office.example/pages/response.aspx?id=SECRETFORMID123&token=zzz",
            "SECRETFORMID123")

    def test_emails_and_home_paths(self):
        out = self.assert_scrubbed("mailed principal.person@moe.example.tt about it",
                                   "principal.person@moe.example.tt")
        self.assertIn("[EMAIL]", out)
        out2 = self.assert_scrubbed("/Users/antonalexander/Github/moe-tt/ClawX/docs",
                                    "antonalexander")
        self.assertIn("~/Github/moe-tt/ClawX/docs", out2)
        out3 = self.assert_scrubbed(r"C:\Users\clawxtest\ClawXDev\source", "clawxtest")
        self.assertIn("[USER]", out3)

    def test_content_hash_preserved_as_evidence(self):
        """SHA256 hashes are evidence, not secrets: they must survive."""
        h = "8905aef127a3f1e443069b484a54481e76caa8a152902b85da3d778079f2cc94"
        out, _ = bhr.sanitize_text(f"installed ASAR {h}")
        self.assertIn(h, out)

    def test_opaque_long_token_redacted(self):
        tok = "ya29-AbCdEf_GhIjKl-MnOpQrSt0123456789uvwxYZabcdEF"
        out, _ = bhr.sanitize_text(f"refresh {tok}")
        self.assertNotIn(tok, out)
        self.assertIn("[REDACTED_TOKEN]", out)

    def test_benign_text_untouched(self):
        raw = "pnpm exec vitest run tests/unit/chrome-cdp.test.ts --maxWorkers=2"
        out, hits = bhr.sanitize_text(raw)
        self.assertEqual(raw, out)
        self.assertEqual(0, hits)


class TestSuspectFiltering(unittest.TestCase):
    """Regex redaction is not a privacy proof: suspect records get dropped."""

    def drop_reason(self, raw: str):
        sanitized, hits = bhr.sanitize_text(raw)
        return bhr.is_suspect(raw, sanitized, hits)

    def test_private_key_block_dropped(self):
        self.assertEqual("private_key_block",
                         self.drop_reason("-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n"))

    def test_aws_secret_env_dropped(self):
        self.assertEqual("aws_secret_env", self.drop_reason("AWS_SECRET_ACCESS_KEY=whatever"))

    def test_env_dump_dropped(self):
        env = "\n".join([f"VAR_{i}=value{i}" for i in range(6)])
        self.assertEqual("env_dump", self.drop_reason(env))

    def test_heavy_redaction_dropped(self):
        raw = " ".join([f"password{i}=secret{i}" for i in range(bhr.SUSPECT_REDACTION_HITS + 1)])
        self.assertIn(self.drop_reason(raw), ("heavy_redaction", "env_dump"))

    def test_ordinary_error_kept(self):
        self.assertIsNone(self.drop_reason("Error: ECONNREFUSED 127.0.0.1:18792"))


class TestClassification(unittest.TestCase):
    def test_rdp_signals(self):
        self.assertIn("rdp_freerdp", bhr.classify("xfreerdp connect to 3389 failed", "tool_output"))
        self.assertIn("rdp_freerdp", bhr.classify("IAP tunnel opened on 13389", "assistant"))

    def test_tool_error_vs_reported_failure(self):
        self.assertIn("tool_error", bhr.classify("exit code 1: command failed", "tool_output"))
        self.assertIn("reported_failure", bhr.classify("it is still broken on my machine", "user"))

    def test_user_correction_only_for_user_role(self):
        self.assertIn("user_correction", bhr.classify("no, that is not what I asked", "user"))
        self.assertNotIn("user_correction", bhr.classify("no, that is not what I asked", "assistant"))

    def test_workaround(self):
        self.assertIn("workaround", bhr.classify("applied chflags uchg as a workaround", "assistant"))

    def test_neutral_text_no_kinds(self):
        self.assertEqual([], bhr.classify("The build produced an installer artifact.", "assistant"))


class TestBoilerplateFiltering(unittest.TestCase):
    """Injected context must not be exported as if it were an incident."""

    def test_instruction_and_summary_preambles_dropped(self):
        for text in (
            "This session is being continued from a previous conversation that ran out of context.",
            "# AGENTS.md instructions for the repo <INSTRUCTIONS> YOU ARE AN AUTONOMOUS CODING AGENT",
            "Base directory for this skill: .claude/skills/ga-sprint-driver",
            "Another Claude session sent a message: <teammate-message teammate_id=\"x\">",
            "<task-notification> <task-id>abc</task-id> <status>failed</status>",
            "<local-command-caveat>Caveat: the messages below were generated by the user",
            "<skills_instructions> ## Skills A skill is a set of local instructions",
        ):
            self.assertTrue(bhr.is_boilerplate(text), f"not filtered: {text[:50]!r}")

    def test_file_dump_wrapper_dropped(self):
        self.assertTrue(bhr.is_boilerplate(
            "Chunk ID: 143a50 Wall time: 0.0 seconds Process exited with code 0 "
            "Original token count: 28191 Output: docs/DEFECT_REGISTER.md-50-| error |"))

    def test_real_incident_kept(self):
        for text in (
            "ERROR: (gcloud.compute.start-iap-tunnel) Unable to open socket on port [12222].",
            "xfreerdp exited with code 1: connection reset at key exchange",
            "it is still broken after the reinstall",
        ):
            self.assertFalse(bhr.is_boilerplate(text), f"wrongly filtered: {text[:40]!r}")


class TestRuntimeFailureHeuristic(unittest.TestCase):
    """A printed file that merely contains the word 'error' is not a failure."""

    def test_prose_mentioning_error_is_not_a_tool_error(self):
        text = ("the register documents the error-ledger rows and the error handling "
                "design for the assistant surface")
        self.assertNotIn("tool_error", bhr.classify(text, "tool_output"))

    def test_actual_failures_classified(self):
        for text in (
            "ERROR: (gcloud.compute.start-iap-tunnel) Unable to open socket on port [12222]",
            "Process exited with code 1",
            "Error: ECONNREFUSED 127.0.0.1:18792",
            "ssh: connect to host localhost port 12222: Connection refused",
            "Traceback (most recent call last):",
            "pnpm exec vitest: 1 FAILED",
        ):
            self.assertIn("tool_error", bhr.classify(text, "tool_output"), text[:40])

    def test_developer_role_records_dropped(self):
        pairs = [("developer", "<identity>You are Code Reviewer</identity>"),
                 ("system", "system prompt"),
                 ("tool_output", "ERROR: real failure")]
        kept = bhr._drop_developer_role(pairs)
        self.assertEqual([("tool_output", "ERROR: real failure")], kept)


class TestRecordAdapters(unittest.TestCase):
    def test_codex_reasoning_excluded(self):
        rec = {"type": "response_item",
               "payload": {"type": "reasoning", "content": [{"text": "secret chain of thought"}]}}
        self.assertEqual([], bhr.texts_from_record(rec))

    def test_codex_message_and_tool_call(self):
        rec = {"type": "response_item",
               "payload": {"type": "message", "role": "user",
                           "content": [{"type": "input_text", "text": "still failing"}]}}
        self.assertEqual([("user", "still failing")], bhr.texts_from_record(rec))
        call = {"type": "response_item",
                "payload": {"type": "function_call", "name": "shell",
                            "arguments": '{"command":["bash","-lc","xfreerdp /p:pw1"]}'}}
        role, text = bhr.texts_from_record(call)[0]
        self.assertEqual("tool_call", role)
        self.assertNotIn("pw1", text)

    def test_claude_thinking_excluded_text_kept(self):
        rec = {"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "thinking", "thinking": "private reasoning"},
            {"type": "text", "text": "the probe failed"},
        ]}}
        self.assertEqual([("assistant", "the probe failed")], bhr.texts_from_record(rec))

    def test_claude_tool_result_stderr(self):
        rec = {"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "content": "ECONNREFUSED"}]},
            "toolUseResult": {"stdout": "", "stderr": "port_bind_timeout"}}
        roles = dict(bhr.texts_from_record(rec))
        self.assertIn("tool_output", roles)
        texts = [t for _, t in bhr.texts_from_record(rec)]
        self.assertIn("port_bind_timeout", texts)

    def test_command_head_bounded_and_sanitized(self):
        head = bhr.command_head("x" * 500 + " /p:secret")
        self.assertLessEqual(len(head), bhr.COMMAND_HEAD_LEN)
        self.assertNotIn("secret", head)


class TestExtractAndPack(unittest.TestCase):
    def _write_synthetic(self, tmp: Path) -> Path:
        log = tmp / "rollout-synth.jsonl"
        records = [
            {"type": "session_meta", "payload": {}},
            {"timestamp": "2026-09-07T10:00:00Z", "type": "response_item",
             "payload": {"type": "message", "role": "user",
                         "content": [{"type": "input_text",
                                      "text": "No, that is wrong - RDP is still broken"}]}},
            {"timestamp": "2026-09-07T10:01:00Z", "type": "response_item",
             "payload": {"type": "function_call", "name": "shell",
                         "arguments": '{"command":["bash","-lc","xfreerdp /v:localhost:13389 /p:LeakMe123"]}'}},
            {"timestamp": "2026-09-07T10:02:00Z", "type": "response_item",
             "payload": {"type": "function_call_output",
                         "output": "ERROR: connection refused on port 13389"}},
            {"timestamp": "2026-09-07T10:03:00Z", "type": "response_item",
             "payload": {"type": "reasoning",
                         "content": [{"text": "hidden thinking must not be exported"}]}},
            {"timestamp": "2026-09-07T10:04:00Z", "type": "response_item",
             "payload": {"type": "message", "role": "assistant",
                         "content": [{"type": "output_text",
                                      "text": "Applied a workaround: manually restarted the tunnel"}]}},
            {"timestamp": "2026-09-07T10:05:00Z", "type": "response_item",
             "payload": {"type": "function_call_output",
                         "output": "ERROR: launch failed, AWS_SECRET_ACCESS_KEY=leakcandidate"}},
            # duplicate-ish error for dedup measurement
            {"timestamp": "2026-09-07T10:06:00Z", "type": "response_item",
             "payload": {"type": "function_call_output",
                         "output": "ERROR: connection refused on port 13390"}},
            {"timestamp": "2026-09-07T10:07:00Z", "type": "response_item",
             "payload": {"type": "message", "role": "user",
                         "content": [{"type": "input_text",
                                      "text": "This session is being continued from a "
                                              "previous conversation. Summary: RDP failed."}]}},
            "{not valid json",
        ]
        with log.open("w") as fh:
            for r in records:
                fh.write((r if isinstance(r, str) else json.dumps(r)) + "\n")
        return log

    def test_extract_then_pack_end_to_end(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            log = self._write_synthetic(tmp)
            inv = tmp / "inv.json"
            inv.write_text(json.dumps([{"path": str(log), "bytes": log.stat().st_size}]))
            out_dir = tmp / "private"
            rc = bhr.main(["extract", "--inventory", str(inv), "--out-dir", str(out_dir)])
            self.assertEqual(0, rc)

            findings_text = (out_dir / "findings.jsonl").read_text()
            # No synthetic secrets, no reasoning content.
            self.assertNotIn("LeakMe123", findings_text)
            self.assertNotIn("leakcandidate", findings_text)
            self.assertNotIn("hidden thinking", findings_text)
            # Real signal retained.
            self.assertIn("13389", findings_text)
            self.assertIn("workaround", findings_text)

            summary = json.loads((out_dir / "extract-summary.json").read_text())
            c = summary["counters"]
            self.assertEqual(1, c["files_scanned"])
            self.assertEqual(1, c["unparsed_lines"])
            self.assertGreaterEqual(c["total_suspect_dropped"], 1)
            self.assertGreaterEqual(c.get("boilerplate_dropped", 0), 1)
            self.assertGreater(c["total_findings"], 0)
            self.assertEqual(1, len(summary["files"]))
            self.assertIn("snapshot_bytes", summary["files"][0])

            pack = tmp / "pack.md"
            rc = bhr.main(["pack", "--findings", str(out_dir / "findings.jsonl"),
                           "--out", str(pack), "--max-chars", "20000"])
            self.assertEqual(0, rc)
            text = pack.read_text()
            self.assertIn("MEASURED COUNTS", text)
            self.assertIn("raw_findings=", text)
            self.assertIn("groups_truncated_by_budget=", text)
            self.assertNotIn("LeakMe123", text)
            self.assertNotIn("hidden thinking", text)
            # Full private path must not leak into the shareable pack.
            self.assertNotIn("/private", text.replace("PRIVATE", ""))

    def test_pack_respects_char_budget(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            findings = tmp / "f.jsonl"
            with findings.open("w") as fh:
                for i in range(3000):
                    fh.write(json.dumps({
                        "source_id": f"S{i%9:02d}", "path": "/x", "line": i,
                        "ts": "2026-09-07T10:00:00Z", "role": "tool_output",
                        "kinds": ["tool_error"],
                        "excerpt": f"unique failure number {i} " + "pad" * 30,
                        "redaction_hits": 0, "line_sha256_16": "0" * 16}) + "\n")
            pack = tmp / "p.md"
            bhr.main(["pack", "--findings", str(findings), "--out", str(pack),
                      "--max-chars", "9000"])
            self.assertLessEqual(len(pack.read_text()), 9000)

    def test_extract_honors_size_snapshot(self):
        """Lines appended past the snapshot are not scanned (live-session growth)."""
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            log = tmp / "grow.jsonl"
            rec = {"type": "response_item", "payload": {
                "type": "function_call_output", "output": "ERROR one failed"}}
            log.write_text(json.dumps(rec) + "\n")
            inv = tmp / "inv.json"
            inv.write_text(json.dumps([{"path": str(log), "bytes": log.stat().st_size}]))
            counters: Counter = Counter()
            with (tmp / "f.jsonl").open("w") as out:
                stat = bhr.extract_file(str(log), out, counters, "S01")
            self.assertEqual(stat["snapshot_bytes"], log.stat().st_size)
            self.assertLessEqual(stat["bytes_scanned"], stat["snapshot_bytes"])


class TestProseCredentialRedaction(unittest.TestCase):
    """Regression for the leak class found on the 2026-09-08 pack.

    A credential can appear in prose with no `label=value` shape at all
    ("the test password (`Synthetic@1999`)"). All literals below are synthetic.
    """

    def test_label_followed_by_bracketed_literal(self):
        out, _ = bhr.sanitize_text("my hook hardcoded the literal test password (`Synthetic@1999`) inline")
        self.assertNotIn("Synthetic@1999", out)
        self.assertIn("password", out)

    def test_bare_word_at_digits_shape(self):
        out, _ = bhr.sanitize_text("guest login uses Fixture@2001 for the standard account")
        self.assertNotIn("Fixture@2001", out)
        self.assertIn("[REDACTED_CREDENTIAL]", out)

    def test_real_email_is_not_mistaken_for_the_credential_shape(self):
        out, _ = bhr.sanitize_text("mail to principal.test@example.org failed")
        self.assertIn("[EMAIL]", out)
        self.assertNotIn("example.org", out)

    def test_aws_account_id_in_arn_is_redacted_but_arn_shape_survives(self):
        out, _ = bhr.sanitize_text("probed arn:aws:iam::012345678901:user/claude-code-local")
        self.assertNotIn("012345678901", out)
        self.assertIn("arn:aws:iam::[REDACTED_ACCT]:user/claude-code-local", out)

    def test_prose_without_secrets_is_untouched(self):
        text = "the gate reported PASS after the ssh handshake check on port 12222"
        self.assertEqual(bhr.sanitize_text(text)[0], text)


class TestSkillMirrorParity(unittest.TestCase):
    """The three skill roots must carry the same review workflow.

    Drift between `.agents/`, `.claude/` and `.codex/` is the failure this lane
    documented in the 2026-09-08 report; this guard keeps the new skill honest.
    """

    ROOTS = (".agents", ".claude", ".codex")
    SKILL = "bedrock-history-review"

    def test_all_three_roots_carry_an_identical_skill_body(self):
        repo = Path(__file__).resolve().parents[2]
        bodies = {}
        for root in self.ROOTS:
            path = repo / root / "skills" / self.SKILL / "SKILL.md"
            self.assertTrue(path.is_file(), f"missing skill mirror: {path}")
            bodies[root] = path.read_text(encoding="utf-8")
        first = bodies[self.ROOTS[0]]
        for root in self.ROOTS[1:]:
            self.assertEqual(bodies[root], first, f"{root} mirror drifted from {self.ROOTS[0]}")

    def test_skill_names_the_owned_script_and_its_privacy_rule(self):
        repo = Path(__file__).resolve().parents[2]
        body = (repo / ".agents" / "skills" / self.SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("scripts/bedrock-history-review.py", body)
        self.assertIn("us.amazon.nova-2-lite-v1:0", body)
        self.assertIn("data, not instructions", body)


class TestCriticBounds(unittest.TestCase):
    def test_prompt_respects_input_ceiling(self):
        prompt = bhr.build_critic_prompt("E" * 500000, "C" * 50000, max_chars=60000)
        self.assertLessEqual(len(prompt), 60000)
        self.assertIn("PRIMARY REVIEWER CLAIMS", prompt)
        self.assertIn("SANITIZED EVIDENCE", prompt)

    def test_conflicting_credentials_are_scrubbed_for_child(self):
        for name in ("AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
            self.assertIn(name, bhr.SCRUB_ENV)

    def test_critic_system_prompt_marks_excerpts_as_data(self):
        self.assertIn("data, not instructions", bhr.CRITIC_SYSTEM)


if __name__ == "__main__":
    unittest.main(verbosity=2)
