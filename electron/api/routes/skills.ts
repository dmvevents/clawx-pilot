import type { IncomingMessage, ServerResponse } from 'http';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import { collectQuickAccessSkills, filterEnabledQuickAccessSkills, type QuickAccessRuntimeSkillStatus, type QuickAccessSkill } from '../../utils/skill-quick-access';
import type { ClawHubInstallParams, ClawHubSearchParams, ClawHubUninstallParams } from '../../gateway/clawhub';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { FILTER_SKILLS_TO_ALLOWLIST, PRINCIPAL_SKILL_ALLOWLIST } from '../../../shared/feature-flags';

/**
 * Pilot-mode filter for the chat composer's slash-command picker.
 *
 * The Skills page already filters to PRINCIPAL_SKILL_ALLOWLIST in
 * src/stores/skills.ts, but the composer reads from this REST endpoint
 * directly (no Zustand store), so we apply the same filter here.
 *
 * Hidden skills remain installed and reachable by the agent through the
 * gateway RPC (skills.run / skills.status) — only the picker UI surface is
 * narrowed. To restore the full list, set CLAWX_FILTER_SKILLS=false or
 * CLAWX_PILOT_MODE=false at build time, or edit shared/feature-flags.ts.
 */
function applyPrincipalAllowlist(skills: QuickAccessSkill[]): QuickAccessSkill[] {
  if (!FILTER_SKILLS_TO_ALLOWLIST) return skills;
  return skills.filter((skill) => PRINCIPAL_SKILL_ALLOWLIST.has(skill.name));
}

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        apiKey: body.apiKey,
        env: body.env,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/quick-access' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        workspace?: string;
      }>(req);
      const [scannedSkills, configs] = await Promise.all([
        collectQuickAccessSkills({
          workspace: body.workspace,
        }),
        getAllSkillConfigs(),
      ]);
      let runtimeSkills: QuickAccessRuntimeSkillStatus[] | undefined;
      if (ctx.gatewayManager.getStatus().state === 'running') {
        try {
          const runtimeStatus = await ctx.gatewayManager.rpc<{ skills?: QuickAccessRuntimeSkillStatus[] }>('skills.status');
          runtimeSkills = runtimeStatus.skills || [];
        } catch {
          runtimeSkills = undefined;
        }
      }
      sendJson(res, 200, {
        success: true,
        skills: applyPrincipalAllowlist(filterEnabledQuickAccessSkills(scannedSkills, runtimeSkills, configs)),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/capability' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        success: true,
        capability: await ctx.clawHubService.getMarketplaceCapability(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<ClawHubSearchParams>(req);
      sendJson(res, 200, {
        success: true,
        results: await ctx.clawHubService.search(body),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<ClawHubInstallParams>(req);
      await ctx.clawHubService.install(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<ClawHubUninstallParams>(req);
      await ctx.clawHubService.uninstall(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  return false;
}
