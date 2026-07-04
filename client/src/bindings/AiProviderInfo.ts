// This file is GENERATED from the Rust `AiProviderInfo` struct by ts-rs.
// Do not edit by hand — it will be overwritten. Regenerate with `cargo test`
// in src-tauri/ (see client/README.md). It's committed so the frontend
// type-checks before the first Rust build.
import type { AiProviderKind } from "./AiProviderKind";

export type AiProviderInfo = {
  kind: AiProviderKind;
  label: string;
  model: string;
  has_key: boolean;
};
