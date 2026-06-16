# Step6 库存配图（今日 / 通用 / AI）

> **实现**：`node/src/step6-generate/stockImagePool.ts`、`generateImages.ts`  
> **范围**：当前按 **单 topic**（一次任务一条 `copy_result.items[0]`）设计。

## 1. 优先级

```text
assets/img/{yyyymmdd}/  →  assets/img/Common/  →  @google/genai / content-image（AI）
```

| 顺序 | 目录 | 条件 | 行为 |
|------|------|------|------|
| 1 | `{yyyymmdd}/` | 目录存在且含图片 | **不调 API**；从该目录选图写入 `image_result` |
| 2 | `Common/` | 同上 | **不调 API**；从 Common 选图 |
| 3 | — | 上述均无可用图 | 走现有 AI 配图（`PUBLISH_ORCH_STEP6_IMAGE_DELIVERY`） |

- **日期目录名**：JST 的 `yyyymmdd`（与 `yyyymmddJst()` 一致）。  
- **Common**：固定目录名 **`Common`**（区分大小写以代码为准）。  
- **扩展名**：`.png`、`.jpg`、`.jpeg`（仅扫描文件，不递归子目录）。

## 2. 选图规则

- 最多 **4** 张（与 `STEP6_IMAGE_SLOT_COUNT` 一致）；不足 4 张则 **有几张用几张**。  
- **同任务重试一致**：随机种子 = `task_id|run_id|stock`（+ 池类型后缀）；库存文件不变则重跑 `generate-images` 选图相同。  
- 路径写入 `image_result.images[].asset_path`（**库存绝对路径**，不复制到 `generate/images/` 除非后续 AI 分支）。

## 3. `image_result` 扩展字段

| 字段 | 说明 |
|------|------|
| `image_source` | `stock_today` \| `stock_common` \| `ai_generated` |
| `stock_pool_dir` | 选用库存时的目录绝对路径（AI 时无） |
| `images[].mode` | `stock_today` \| `stock_common` \| `node_genai` 等 |
| `images[].status` | 库存图为 `success` |

## 4. 配置路径

- 根目录：`config/paths.json` → **`assets_img_dir`**（默认 `./data/assets/img`）。  
- 示例布局：

```text
data/assets/img/
  20260527/          # 当日预置/人工图
    a.png
  Common/            # 通用兜底
    fallback.jpg
```

## 5. Step7 关系

- Step6 已将最终 `asset_path` 写入 `image_result`；**Step7 仍只读 `image_result`**，无需再查库存目录。  
- Slack Step6 通知中的 **图片来源：今日/通用/AI生成** 与 `image_source` 对应。

## 6. 环境变量

| 变量 | 作用 |
|------|------|
| `PUBLISH_ORCH_FORCE_AI_IMAGES=1` | 忽略库存，强制走 API |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | AI 分支必填 |
| `PUBLISH_ORCH_STEP6_IMAGE_DELIVERY` | `node`（默认）\| `role` |

详见 `steps/step6_generation.md`、`docs/manual_commands.md`。
