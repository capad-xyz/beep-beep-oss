// This file is GENERATED from the Rust `AiProviderInput` struct by ts-rs.
// Do not edit by hand — it will be overwritten. Regenerate with `cargo test`
// in src-tauri/ (see client/README.md). It's committed so the frontend
// type-checks before the first Rust build.
import type { AiProviderKind } from "./AiProviderKind";

export type AiProviderInput = {
  kind: AiProviderKind;
  label: string;
  base_url: string;
  model: string;
  embed_model: string | null;
  api_key: string | null;
};
