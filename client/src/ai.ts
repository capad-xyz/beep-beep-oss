// Typed wrappers around the AI command surface (see src-tauri/src/ai.rs).
//
// Like api.ts, this is the ONLY place the frontend talks to the AI core. Args go
// out in camelCase; Tauri maps them to the Rust commands' snake_case parameters.
// The imported types are GENERATED from Rust by ts-rs (see src/bindings/) — never
// edit those by hand; regenerate them.

import { invoke } from "@tauri-apps/api/core";
import type { AiProviderInput } from "./bindings/AiProviderInput";
import type { AiProviderInfo } from "./bindings/AiProviderInfo";
import type { AiAnswer } from "./bindings/AiAnswer";

/** Select/replace the active AI provider (called from the settings screen). */
export async function setAiProvider(config: AiProviderInput): Promise<void> {
  return invoke<void>("ai_set_provider", { config });
}

/** The active provider, minus the secret key (or null if none configured). */
export async function activeAiProvider(): Promise<AiProviderInfo | null> {
  return invoke<AiProviderInfo | null>("ai_active_provider");
}

/** Summarize one room's recent messages. */
export async function summarizeRoom(roomId: string): Promise<string> {
  return invoke<string>("ai_summarize_room", { roomId });
}

/** Ask a question grounded in chat context. `roomId` required until RAG lands. */
export async function askInbox(question: string, roomId?: string): Promise<AiAnswer> {
  return invoke<AiAnswer>("ai_ask", { question, roomId: roomId ?? null });
}

/**
 * Starter presets for the two hackathon backends + the bring-your-own path.
 * Fill `base_url` / `model` from your cloud console, then merge with an `api_key`
 * before calling setAiProvider(). These document the exact endpoints we target.
 */
export const PROVIDER_PRESETS: Record<string, Omit<AiProviderInput, "api_key">> = {
  // AMD Act II: point at your vLLM server on an MI300X instance.
  amd: {
    kind: "AmdDevCloud",
    label: "AMD MI300X (Qwen2.5)",
    base_url: "http://<your-amd-vllm-host>:8000/v1", // VERIFY: your deployed host
    model: "Qwen/Qwen2.5-72B-Instruct",
    embed_model: null,
  },
  // Qwen Cloud: DashScope OpenAI-compatible endpoint (use the China host if applicable).
  qwen: {
    kind: "QwenCloud",
    label: "Qwen Cloud",
    base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    embed_model: "text-embedding-v3",
  },
  // Bring-your-own DeepSeek key.
  deepseek: {
    kind: "DeepSeek",
    label: "DeepSeek (my key)",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    embed_model: null,
  },
};
