# schema_artifacts.md

## 1. 适用范围
适用于 collect/tidy/analyze/approve/deep_collect/generate/publish 全部结果文件。

## 2. 兼容与版本策略
- 每个产物文件必须包含：`schema_version`、`task_id`、`run_id`、`generated_at`
- 时间字段（如 `generated_at`）使用 ISO8601 并统一时区 `Asia/Tokyo`
- 新增字段向后兼容；删除字段需先标记 deprecated

## 3. 各产物最小字段

### 3.1 collect_result
- `schema_version` `generated_at`
- `task_id` `run_id`
- `ok`
- `items[]`（至少含 title/source_platform/source_url/collected_at）
- `meta`（来源统计、采集参数）
- `errors[]`

### 3.2 topic_candidates（Step3 Tidy，当前主路径）

- `schema_version`: `topic_candidates.v1`
- `generated_at`
- `task_id` `run_id`
- `source_collect_ref`（首轮 `collect_result` 路径）
- `items[]`：每条至少含 `index`（1-based 展示编号）、`topic_id`、`title`、`source_platform`、`source_url`（可空字符串）

### 3.3 clean_result（遗留）

- 曾由已移除的 `analyzer-role` 产出；Step4 仍可按路径兼容读取
- `schema_version` `generated_at`
- `task_id` `run_id`
- `items[]`（含评分、风险标记、推荐理由等，视历史版本）
- `dedupe_meta`

### 3.4 selected_topics
- `schema_version` `generated_at`
- `task_id` `run_id`
- `selected_topic_ids[]`
- `selected_by`
- `selected_at`

### 3.4b selected_collect_items（选题后从首轮 collect 切片）

- `schema_version`: `selected_collect_items.v1`
- `generated_at` `task_id` `run_id`
- `source_collect_ref` `source_candidates_ref`
- `selected_indices[]`（与 `topic_candidates` 中 `index` 一致）
- `topic_keys[]`：`topic_id` + `source_platform`
- `items[]`：与 `collect_result.items` 中元素结构相同的全量条目（用于二次采集输入）

### 3.5 deep_collect_result
- `schema_version` `generated_at`
- `task_id` `run_id`
- `topics[]`（扩展文本、来源、媒体）

### 3.6 copy_result
- `schema_version` `generated_at`
- `task_id` `run_id`
- `items[]`：`topic_id` `title` `writing_angle`
- `drafts[]`：**仅** `xiaohongshu` | `facebook` | `x` | `instagram`；正文 **简体中文**；字数见 `../../01_detailed_design/step6_copy_image_spec.md`；**`tags[]` 不计入 body**
- `image_prompts[]`：**恰好 4 条**（`img_1`…`img_4`）；`prompt` **英文为主**；`aspect_ratio` **16:9**

### 3.7 image_result
- `schema_version` `generated_at`
- `task_id` `run_id`
- `images[]`：每 topic **最多 4 条** slot（公用素材 PNG 路径）；`mode` / `prompt` / `asset_path` / `style` / `aspect_ratio`

### 3.8 publish_result
- `schema_version` `generated_at`
- `task_id` `run_id`
- `platform_results[]`（platform/status/post_id_or_url/error）
- `summary`
