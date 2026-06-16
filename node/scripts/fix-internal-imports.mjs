import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const REPLACEMENTS = [
  ["./step6GenerateCopy.js", "./generateCopy.js"],
  ["./step6GenerateImages.js", "./generateImages.js"],
  ["./step6Constants.js", "./constants.js"],
  ["./step6MergeImagePrompts.js", "./mergeImagePrompts.js"],
  ["./step6ImageRecords.js", "./imageRecords.js"],
  ["./step6ImageNodeGenerate.js", "./imageNodeGenerate.js"],
  ["./step6ImageRoleDispatch.js", "./imageRoleDispatch.js"],
  ["./step6ImageDelivery.js", "./imageDelivery.js"],
  ["./step6CopyRoleDispatch.js", "./copyRoleDispatch.js"],
  ["./step6TopicResearch.js", "./topicResearch.js"],
  ["./step4Json.js", "../step4-approval/json.js"],
  ["./step4ApplyPick.js", "./applyPick.js"],
  ["./step4SlackNotify.js", "./slackNotify.js"],
  ["./step4RoleDispatch.js", "./roleDispatch.js"],
  ["./step4ResearchRoleDispatch.js", "./researchRoleDispatch.js"],
  ["./step4TopicResearch.js", "./topicResearch.js"],
  ["./step4SlackNotify.js", "../step4-approval/slackNotify.js"],
  ["./step4TopicResearch.js", "../step4-approval/topicResearch.js"],
];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith(".ts")) {
      let t = fs.readFileSync(p, "utf-8");
      let changed = false;
      for (const [a, b] of REPLACEMENTS) {
        if (t.includes(a)) {
          t = t.split(a).join(b);
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(p, t, "utf-8");
    }
  }
}

walk(ROOT);
console.log("fixed internal imports");
