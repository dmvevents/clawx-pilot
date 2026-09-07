# Windows Demo Resume

Resume the ClawX / Ministry Windows demo stabilization work from repo artifacts, not from chat memory.

Read first:

- `CLAUDE.md`
- `docs/PROJECT_CONTRACT.md`
- `docs/COMPLETION_PLAN.md`
- `docs/CURRENT_WINDOWS_RC.md`
- `.claude/skills/windows-demo-resume/SKILL.md`
- `.claude/skills/windows-runtime-recovery/SKILL.md`
- `windows-pilot/README.md`
- `windows-pilot/AGENTS.md`

Then run read-only local probes:

```bash
pwd
git status --short
find .claude -maxdepth 3 -type f -print | sort
find windows-pilot -maxdepth 3 -type f -print | sort | sed -n '1,160p'
```

Report:

1. Current target result.
2. Current authoritative docs/skills/agents.
3. Dirty/untracked files relevant to the demo.
4. Whether live Windows state has been probed in this session.
5. The safest next action and the validation evidence it will produce.

Safety:

- Do not send email, download attachments, submit forms, print secrets, or mutate Windows state during the resume pass.
- Use read-only Windows probes first if live pilot state is needed.
- If the user asks for parallelism, use bounded subagents or Agent Teams with explicit context packets and safety gates.
