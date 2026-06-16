import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import { loadPublishOrchestratorConfig } from "../../src/orchestrator/publishOrchestratorConfig.js";
import { publishFromHome } from "./publish.home.js";
import { publishFromProfile } from "./publish.profile.js";

export type FacebookComposerEntry = "home" | "profile";

/**
 * Facebook 发布入口：按 step7.facebook.composer_entry 分发到 home / profile 实现。
 */
export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const orch = loadPublishOrchestratorConfig();
  const entry: FacebookComposerEntry = orch.step7.facebook.composer_entry;
  if (entry === "profile") {
    const profileOpts: { profileLinkName?: string } = {};
    const name = orch.step7.facebook.profile_link_name.trim();
    if (name) profileOpts.profileLinkName = name;
    return publishFromProfile(ctx, profileOpts);
  }
  const homeOpts: { displayName?: string } = {};
  const displayName = orch.step7.facebook.profile_link_name.trim();
  if (displayName) homeOpts.displayName = displayName;
  return publishFromHome(ctx, homeOpts);
}

export { publishFromHome } from "./publish.home.js";
export { publishFromProfile } from "./publish.profile.js";
