# CLWX Plane board API

Verified against the running self-hosted instance on September 7, 2026. The live board owns work status; the [JSON export](plane-board/CLWX-board-export.json) and [Markdown mirror](plane-board/CLWX-board.md) retain a snapshot. Keep updates on existing cards and preserve their full acceptance criteria.

## Connection and compatibility

| Setting | Verified value |
|---|---|
| Base URL | `http://localhost:8090` |
| Workspace | `issues-agent` |
| Project identifier | `CLWX` |
| Project UUID | `81a2ea23-e060-49b4-a344-1ab0339f46d5` |
| Credential file | `~/issues-agent-runtime/plane/.agent-token` |
| Header | `X-API-Key` from `PLANE_API_KEY` |

The credential file also defines `PLANE_PROJECT`, which points to **another project**. The CLWX writer deliberately ignores it. Set `CLWX_PROJECT_ID` explicitly and verify the returned project identifier and issue project before writing. Never print the key or place it in command arguments, board text or committed files.

Plane documents JSON REST requests, API-key headers, cursor pagination (maximum `per_page=100`) and rate limits of 60 requests per minute per key. Self-hosted deployments use their own base URL. Follow returned `next_page_results` and `next_cursor`, and honor HTTP 429 retry timing. These are upstream rules; observed instance behavior is recorded separately. [Official API introduction](https://developers.plane.so/api-reference/introduction).

Current upstream documentation uses `/work-items/` and announces retirement of `/issues/`. This installed instance and the existing repo tools were verified through `/issues/`; the server has not been upgraded or its API renamed by this task. Before migrating tools, test list/detail/comment identity and readback against the installed version. Never retry a possibly completed POST against a different route. [Upstream migration notice](https://developers.plane.so/api-reference/issue/overview).

Let `P=/api/v1/workspaces/issues-agent/projects/81a2ea23-e060-49b4-a344-1ab0339f46d5`:

| Operation | Verified installed route |
|---|---|
| Confirm project | `GET P/` |
| Resolve state IDs | `GET P/states/` |
| Paginate cards | `GET P/issues/?per_page=100` |
| Read full card | `GET P/issues/<issue-uuid>/` |
| Change state only | `PATCH P/issues/<issue-uuid>/` with `{"state":"<state-uuid>"}` |
| List comments | `GET P/issues/<issue-uuid>/comments/` |
| Read posted comment | `GET P/issues/<issue-uuid>/comments/<comment-uuid>/` |

PATCH changes specified fields; do not replace the full card or rewrite acceptance text during a status update. Re-read immediately before changing state, reconcile concurrent changes, and verify the result afterward. [Official update contract](https://developers.plane.so/api-reference/issue/update-issue-detail).

## Comment and state workflow

1. Read the card description and recent comments under the verified project. Choose one engineering owner for mutations; parallel researchers remain read-only.
2. Prepare a JSON file with `comment_html`. Include a dated marker, measured result, exact artifact/source scope, evidence path and remaining acceptance gaps. Keep raw account/config/chat evidence private.
3. With the key loaded into the process environment, run `node scripts/plane-comment-post.mjs --card CLWX-95 --file <payload.json>`. This is the canonical writer. It validates project/card identity and reads the created comment back through both detail and list routes.
4. Save the returned comment UUID and timestamp. If readback is inconclusive, check that UUID before posting again. A successful POST response alone is insufficient: this deployment previously accepted cross-project writes that were absent from the correct board view.
5. Update only the intended state after comparing the latest card. **Ready** means the full card evidence exists; **Done** remains human-owned. A startup fix alone cannot close CLWX-95's mid-turn recovery requirement.
6. After mutations complete, run `node scripts/plane-board-export.mjs` with the same environment. Verify issue count, intended states, evidence markers and absence of enrichment gaps against live reads; the export script does not itself prove every enrichment succeeded.

The upstream comment API accepts `comment_html` on POST and exposes list/detail read routes. Repo project checks and double readback are additional local safeguards. [Create comment](https://developers.plane.so/api-reference/issue-comment/add-issue-comment), [list comments](https://developers.plane.so/api-reference/issue-comment/list-issue-comments), [comment detail](https://developers.plane.so/api-reference/issue-comment/get-issue-comment-detail).

## State meaning on this board

| State | Plane group | Use |
|---|---|---|
| Backlog | `backlog` | Unstarted work |
| Todo | `unstarted` | Selected work |
| In Progress | `started` | Active work or validation |
| Ready | `unstarted` | Agent evidence complete, awaiting human review |
| Done | `completed` | Human closure |
| Cancelled | `cancelled` | Retired/duplicate work; retain history |

Do not infer closure from group ordering: this instance's Ready state is in `unstarted`. Never turn board counts or a Ready card into a GA claim. Use the [completion plan](COMPLETION_PLAN.md) and installed acceptance evidence for that decision.
