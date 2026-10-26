// The person's batch through Tauri commands (app/src-tauri/src/commands/batch.rs).

import { invoke } from "@tauri-apps/api/core";

import type { BatchOps, BatchRun, PageBlocks } from "./batch-types";

export const tauriBatch: BatchOps = {
  runBatch: (changes, reason) => invoke<BatchRun>("batch_run", { changes, reason: reason ?? null }),
  pageBlocks: (path) => invoke<PageBlocks>("page_blocks", { path }),
  newTagFile: (tag) => invoke<string>("new_tag_file", { tag }),
};
