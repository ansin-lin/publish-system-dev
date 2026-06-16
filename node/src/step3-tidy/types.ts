import type { JsonObject } from "../step2-collect/types.js";

export type TidyFromCollectSuccess = {
  ok: true;
  outputPath: string;
  stepPatch: JsonObject;
};

export type TidyFromCollectFailure = {
  ok: false;
  stepPatch: JsonObject;
};

export type TidyFromCollectExecution = TidyFromCollectSuccess | TidyFromCollectFailure;
