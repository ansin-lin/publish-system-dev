/**
 * One-shot: copy publish-system/node -> node-new with step-based src layout.
 * Does not modify original node/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE_NEW = path.resolve(HERE, "..");
const NODE_OLD = path.resolve(NODE_NEW, "..", "node");

const MOVES = [
  ["src/core", "src/shared"],
  ["src/analyze", "src/shared/analyze"],
  ["src/collect", "src/step2-collect"],
  ["src/tidy", "src/step3-tidy"],
  ["src/orchestrator", "src/orchestrator"],
  ["src/api", "src/api"],
  ["src/cli", "src/cli"],
  ["src/scripts", "src/scripts"],
  ["src/publish", "src/step7-publish/publish"],
  ["platforms", "platforms"],
];

const FILE_MOVES = [
  ["src/orchestrator/createTask.ts", "src/step1-create/createTask.ts"],
  ["src/executors/step2Collect.ts", "src/step2-collect/executor.ts"],
  ["src/executors/stepTidyFromCollect.ts", "src/step3-tidy/fromCollect.ts"],
  ["src/executors/step4ApplyPick.ts", "src/step4-approval/applyPick.ts"],
  ["src/executors/step4Json.ts", "src/step4-approval/json.ts"],
  ["src/executors/step4Pipeline.ts", "src/step4-approval/pipeline.ts"],
  ["src/executors/step4ResearchRoleDispatch.ts", "src/step4-approval/researchRoleDispatch.ts"],
  ["src/executors/step4RoleDispatch.ts", "src/step4-approval/roleDispatch.ts"],
  ["src/executors/step4SlackNotify.ts", "src/step4-approval/slackNotify.ts"],
  ["src/executors/step4TopicResearch.ts", "src/step4-approval/topicResearch.ts"],
  ["src/executors/materializeSelectedCollect.ts", "src/step4-approval/materializeSelectedCollect.ts"],
  ["src/executors/step5GenerateResearch.ts", "src/step5-research/generateResearch.ts"],
  ["src/executors/step6Constants.ts", "src/step6-generate/constants.ts"],
  ["src/executors/step6CopyRoleDispatch.ts", "src/step6-generate/copyRoleDispatch.ts"],
  ["src/executors/step6GenerateCopy.ts", "src/step6-generate/generateCopy.ts"],
  ["src/executors/step6GenerateImages.ts", "src/step6-generate/generateImages.ts"],
  ["src/executors/step6ImageDelivery.ts", "src/step6-generate/imageDelivery.ts"],
  ["src/executors/step6ImageNodeGenerate.ts", "src/step6-generate/imageNodeGenerate.ts"],
  ["src/executors/step6ImageRecords.ts", "src/step6-generate/imageRecords.ts"],
  ["src/executors/step6ImageRoleDispatch.ts", "src/step6-generate/imageRoleDispatch.ts"],
  ["src/executors/step6MergeImagePrompts.ts", "src/step6-generate/mergeImagePrompts.ts"],
  ["src/executors/step6Pipeline.ts", "src/step6-generate/pipeline.ts"],
  ["src/executors/step6TopicResearch.ts", "src/step6-generate/topicResearch.ts"],
  ["src/executors/buildPublishJobFromStep6.ts", "src/step6-generate/buildPublishJob.ts"],
  ["src/executors/step7Publish.ts", "src/step7-publish/executor.ts"],
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function walkTs(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, fn);
    else if (ent.name.endsWith(".ts")) fn(p);
  }
}

function patchImports(filePath) {
  let t = fs.readFileSync(filePath, "utf-8");
  const rules = [
    [/from "\.\.\/core\//g, 'from "../shared/'],
    [/from "\.\.\/\.\.\/core\//g, 'from "../../shared/'],
    [/from "\.\.\/\.\.\/\.\.\/core\//g, 'from "../../../shared/'],
    [/from "\.\.\/collect\//g, 'from "../step2-collect/'],
    [/from "\.\.\/\.\.\/collect\//g, 'from "../../step2-collect/'],
    [/from "\.\.\/tidy\//g, 'from "../step3-tidy/'],
    [/from "\.\.\/\.\.\/tidy\//g, 'from "../../step3-tidy/'],
    [/from "\.\.\/publish\//g, 'from "../step7-publish/publish/'],
    [/from "\.\.\/\.\.\/publish\//g, 'from "../../step7-publish/publish/'],
    [/from "\.\.\/analyze\//g, 'from "../shared/analyze/'],
    [/from "\.\.\/\.\.\/analyze\//g, 'from "../../shared/analyze/'],
    [/from "\.\.\/executors\/step2Collect\.js"/g, 'from "../step2-collect/executor.js"'],
    [/from "\.\.\/executors\/stepTidyFromCollect\.js"/g, 'from "../step3-tidy/fromCollect.js"'],
    [/from "\.\.\/executors\/step4ApplyPick\.js"/g, 'from "../step4-approval/applyPick.js"'],
    [/from "\.\.\/executors\/step4Pipeline\.js"/g, 'from "../step4-approval/pipeline.js"'],
    [/from "\.\.\/executors\/step4SlackNotify\.js"/g, 'from "../step4-approval/slackNotify.js"'],
    [/from "\.\.\/executors\/step5GenerateResearch\.js"/g, 'from "../step5-research/generateResearch.js"'],
    [/from "\.\.\/executors\/step6GenerateCopy\.js"/g, 'from "../step6-generate/generateCopy.js"'],
    [/from "\.\.\/executors\/step6GenerateImages\.js"/g, 'from "../step6-generate/generateImages.js"'],
    [/from "\.\.\/executors\/step6Pipeline\.js"/g, 'from "../step6-generate/pipeline.js"'],
    [/from "\.\.\/executors\/buildPublishJobFromStep6\.js"/g, 'from "../step6-generate/buildPublishJob.js"'],
    [/from "\.\.\/executors\/step7Publish\.js"/g, 'from "../step7-publish/executor.js"'],
    [/from "\.\.\/executors\/materializeSelectedCollect\.js"/g, 'from "../step4-approval/materializeSelectedCollect.js"'],
    [/from "\.\.\/\.\.\/src\/core\//g, 'from "../../src/shared/'],
    [/from "\.\.\/\.\.\/\.\.\/src\/core\//g, 'from "../../../src/shared/'],
    [/from "\.\/createTask\.js"/g, 'from "../step1-create/createTask.js"'],
  ];
  for (const [re, rep] of rules) t = t.replace(re, rep);
  fs.writeFileSync(filePath, t, "utf-8");
}

// clean dest src/platforms partial
if (fs.existsSync(path.join(NODE_NEW, "src"))) {
  fs.rmSync(path.join(NODE_NEW, "src"), { recursive: true, force: true });
}
if (fs.existsSync(path.join(NODE_NEW, "platforms"))) {
  fs.rmSync(path.join(NODE_NEW, "platforms"), { recursive: true, force: true });
}

for (const [srcRel, destRel] of MOVES) {
  const src = path.join(NODE_OLD, srcRel);
  const dest = path.join(NODE_NEW, destRel);
  if (!fs.existsSync(src)) {
    console.warn("skip missing", srcRel);
    continue;
  }
  copyDir(src, dest);
  console.log("copied dir", srcRel, "->", destRel);
}

for (const [srcRel, destRel] of FILE_MOVES) {
  const src = path.join(NODE_OLD, srcRel);
  const dest = path.join(NODE_NEW, destRel);
  if (!fs.existsSync(src)) {
    console.warn("skip missing file", srcRel);
    continue;
  }
  copyFile(src, dest);
  console.log("copied file", destRel);
}

// remove duplicate createTask from orchestrator if copied to step1
const orchCreate = path.join(NODE_NEW, "src/orchestrator/createTask.ts");
if (fs.existsSync(orchCreate)) fs.unlinkSync(orchCreate);

walkTs(path.join(NODE_NEW, "src"), patchImports);
walkTs(path.join(NODE_NEW, "platforms"), patchImports);

console.log("done");
