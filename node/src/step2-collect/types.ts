export type JsonObject = Record<string, unknown>;

export type CollectorInput = {
  platform: string;
  limit: number;
  query: string;
  extras?: JsonObject;
};

export type TopicItem = {
  platform: string;
  title: string;
  url: string;
  score: number;
  rank: number;
  source_id: string;
  raw: JsonObject;
  fetched_at: string;
};

export type NormalizedCollectItem = {
  topic_id: string;
  title: string;
  source_platform: string;
  source_url: string;
  collected_at: string;
  score?: unknown;
  rank?: unknown;
  raw: JsonObject;
};

export type CollectError = {
  platform: string;
  stage: string;
  error_code: "NETWORK_ERROR" | "NOT_IMPLEMENTED" | "UNKNOWN_ERROR";
  error_message: string;
  source: string;
  retryable: boolean;
};

export type PlatformStats = Record<
  string,
  {
    ok: boolean;
    count: number;
    source: string;
    duration_ms: number;
  }
>;

export type Step2Config = {
  enabledPlatforms: string[];
  enabledSources: string[];
  limit: number;
  query: string;
  allowPartialSuccess: boolean;
  minCandidatesAfterClean: number;
  standaloneExtrasBySource: Record<string, JsonObject>;
  retryMaxAttempts: number;
  retryBackoffMs: number[];
};

export type CollectResult = {
  schema_version: "collect_result.v1";
  generated_at: string;
  task_id: string;
  run_id: string;
  ok: boolean;
  items: NormalizedCollectItem[];
  meta: {
    started_at: string;
    finished_at: string;
    platform_stats: PlatformStats;
    requested: {
      aggregate_platforms: string[];
      standalone_sources: string[];
    };
    pipeline: {
      fetch_limit_per_platform_or_source: number;
      min_candidates_after_clean: number;
      allow_partial_success: boolean;
    };
  };
  errors: CollectError[];
};

export type PathSettings = {
  dataDir: string;
  tasksDir: string;
  logsDir: string;
  logsTaskDir?: string;
  logsPublishDir?: string;
  logsJobsDir?: string;
  systemLog?: string;
};

export type CollectRuntimeSettings = {
  workspaceDir: string;
  repoRoot: string;
  paths: PathSettings;
};

export type CollectTaskParams = {
  taskJsonPath: string;
  aggregateConfigPath?: string;
  standaloneConfigPath?: string;
  settings?: CollectRuntimeSettings;
};

export type CollectTaskRunResult = {
  taskPath: string;
  outputPath: string;
  result: CollectResult;
};

export type CollectSource = {
  id: string;
  dataSource: string;
  fetch(input: CollectorInput): Promise<TopicItem[]>;
};
