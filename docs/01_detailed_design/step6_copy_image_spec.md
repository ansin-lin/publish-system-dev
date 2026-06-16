# Step6 文案与配图产品规范（content-copy / 配图）

> **状态**：已定稿（2026-05-21）  
> **角色**：`workspace-content-copy/AGENTS.md`、`workspace-content-image/AGENTS.md`（role 模式）  
> **编排**：`publish-system/node/src/executors/step6*.ts`  
> **流水线设计**：`docs/00_basic_design/spec/steps/step6_generation.md`

## 1. 范围

- **发布文案平台（仅 4 个）**：`xiaohongshu`、`facebook`、`x`、`instagram`（与 Playwright 发布器主渠道对齐；**不含** weibo/zhihu/youtube/tiktok 文案）。
- **配图**：每个 topic **固定 4 张**，**公用素材**（非每平台各 4 张）。
- **语言**：各平台正文/标题语言由 **`publish.orchestrator.json`** 的 `platforms.definitions.<id>.copy.locale` 决定；`image_prompts[].prompt` **英文为主**（见 §6）。

## 2. content-copy 输出契约

### 2.1 根字段

| 字段 | 说明 |
|------|------|
| `writing_angle` | 中文；选定写作角度 |
| `drafts[]` | **恰好 4 条**，平台 id 见 §3 |
| `image_prompts[]` | **恰好 4 条**，`slot_id` 为 `img_1`～`img_4` |

### 2.2 字数（Unicode 码点，含中文/标点/空格/emoji）

**仅校验 `body`（及小红书 `title`）；`tags[]` 不计入 `body` 上限。**

| platform | title | body |
|----------|-------|------|
| `xiaohongshu` | ≤ **16** | ≤ **800** |
| `facebook` | 可选、宜短 | ≤ **300** |
| `x` | 可选、宜短 | ≤ **200** |
| `instagram` | 可选、宜短 | ≤ **100** |

- **`tags[]`**：中文话题名（2～8 字为宜），**不带 `#`**；发布层可自行加 `#`。
- **禁止**把长文塞进 `tags` 规避 `body` 限制。
- 若 Step7 将 `tags` 拼入发帖正文，拼后总长由发布层约束；Step6 硬校验仍只针对 `body`/`title` 字段。

### 2.3 `image_prompts[]`（固定 4 条）

| 项 | 规则 |
|----|------|
| 条数 | **必须 4 条**（`img_1`…`img_4`），与 `research.images[]` 条数无关 |
| `prompt` | **英文为主**（构图、光线、主体、氛围）；勿把整段中文正文写入 prompt |
| `style` | 建议 `tech editorial` |
| `aspect_ratio` | 统一 **`16:9`** |
| 语义 | 四张均贴合同一选题；可作为公用素材包（封面 / 界面或数据 / 人物或场景 / 抽象或概念等分工由模型在 4 条内自行区分） |

`research.images[4+]` 仅作创作参考；**merge 与出图只使用前 4 条** copy prompt + 前 4 条 research 画面描述（见 §4）。

## 3. 禁止与校验

- **禁止**输出 weibo、zhihu 等未在 §1 列出的 `drafts.platform`。
- 编排器 **`validateDraftLimits`**：缺平台、超字数、image_prompts 非 4 条 → Step6 copy **失败**，可重跑。
- 不写可核实假数据、不写 exploit 教程（同 `memo.md` IT 约束）。

## 4. 配图 merge 与生成

1. **`mergeImagePromptSlots`**：`n = 4`；`copyPrompts` 取前 4 条；`researchImages[i]` 仅 `i = 0..3`，第 5 条及以后 **忽略**。
2. **`merged_prompt`** = `image_prompts[i].prompt` +（若有）`research.images[i]` 画面描述。
3. **出图**：默认 Node `@google/genai`；每个 topic 生成 **4 个 PNG**（`{topic_id}_img_1.png` … `_img_4.png`）。
4. 环境变量 `PUBLISH_ORCH_STEP6_IMAGE_MAX_SLOTS` 默认与 **4** 对齐；小于 4 时以 env 为准（调试用）。

## 5. 与 Step7 发布的关系（约定）

- **图**：`payloads.default.images` 可引用上述 4 张绝对路径，各平台 **共用**。
- **文**：`payloads.<platform>.content` 从 `copy_result.items[].drafts[]` 按 `platform` 映射。
- **未在本规范定义的渠道**（如 youtube/tiktok）不在 Step6 生成文案，需另立规范。

## 6. 多语言（按平台 `copy.locale`）

- 配置：`platforms.definitions.<platform>.copy.locale`（BCP47，如 `zh-CN`、`en-US`、`ja-JP`）。
- Step6 `buildCopyMessage` 将各平台语言与字数写入 `content-copy` 指令；模型须在每条 draft 返回 **`locale`** 字段。
- **`writing_angle`**：仍为中文（内部角度）；**`image_prompts`**：仍为英文为主。
- **`tags[]`**：`zh-*` 为中文话题名且不带 `#`；其它语言与正文一致或 hashtag 写入 `body`。
- Step7 只读 `drafts[].title` / `body` / `tags`，不解析 locale（审计用）。

## 7. 参考文件

- `workspace-content-copy/AGENTS.md`
- `workspace-content-image/AGENTS.md`（`PUBLISH_ORCH_STEP6_IMAGE_DELIVERY=role` 时）
- `docs/01_detailed_design/memo.md`（IT 宣传总则）
- `docs/01_detailed_design/content_copy_brand_optimization.md`（**规划中**：文案自然度、公司宣传、research 引用与质检方案）
