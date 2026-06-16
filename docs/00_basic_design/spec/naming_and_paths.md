# naming_and_paths.md

## 1. 适用范围
适用于所有任务产物文件、目录与日志文件。

## 2. 根路径约定
- `DATA_ROOT`：由配置指定（示例：`C:\Users\compu\.openclaw\publish-system\data\tasks`）
- `LOG_ROOT`：由配置指定（示例：`C:\Users\compu\.openclaw\publish-system\logs`）
- 统一时区：`Asia/Tokyo`（JST, UTC+09:00）

## 3. 产物命名规则
统一：`<name>_YYYYMMDD[_runid].json`

日期口径：`YYYYMMDD` 按 `Asia/Tokyo` 计算（不是 UTC）。

说明：命名规范不替代 Schema 约束；产物内容必须满足 `schema_artifacts.md` 的必填字段要求（如 `schema_version/task_id/run_id/generated_at`）。

示例：
- `collect_result_20260508_r01.json`
- `clean_result_20260508_r01.json`
- `selected_topics_20260508_r01.json`
- `publish_result_20260508_r01.json`

## 4. 目录布局（唯一来源）
`DATA_ROOT/<task_id>/`
- `task.json`
- `collect/`
- `analyze/`
- `approve/`
- `deep_collect/`
- `generate/`
- `publish/`

## 5. 日志命名
- `<step>_<task_id>_<YYYYMMDD_HHMMSS>.log`
- 或 `<step>_<task_id>_<YYYYMMDD>.jsonl`

禁止项：
- 禁止长期写入通用单文件名（如 `run.log`）
- 禁止跨 task 混写同一日志文件
