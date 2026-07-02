//! AI provider abstraction — the brain layer behind "Inbox Intelligence".
//!
//! WHY THIS EXISTS / DESIGN
//! Beeper's value here is NOT a model; it's the *unified inbox* as context — one
//! place that already holds your WhatsApp + Instagram + ... history. The AI layer
//! must therefore be **provider-agnostic**: the same summarize / ask / (later)
//! image-search features run against whichever backend the user configured. That
//! single property is what lets ONE build target multiple hackathons:
//!   - AMD Act II  → an open model (Qwen / DeepSeek / Llama) served on AMD MI300X
//!                   via ROCm + vLLM.
//!   - Qwen Cloud  → Qwen served on Alibaba's Qwen Cloud (DashScope).
//!   - Bring-your-own → user pastes a DeepSeek / OpenAI key.
//!
//! The trick: all four speak the SAME OpenAI-compatible HTTP shape
//! (`/chat/completions`, `/embeddings`). So one HTTP provider parameterised by
//! `{ base_url, model, api_key }` covers every case, and providers differ only by
//! config. The `AiProvider` trait exists so a *non*-compatible backend can be
//! added later without touching the callers.
//!
//! LICENSING NOTE (hackathon eligibility)
//! This module is deliberately **network-isolated**: it talks to model endpoints
//! over HTTP, and to Matrix only through `MatrixState`'s typed helpers. It does
//! not link any AGPL core at the source level, so it can be dual-licensed (e.g.
//! MIT) for a permissive-license hackathon while the Beeper client core stays
//! AGPL. Keep this boundary clean — do not reach into Matrix internals from here.
//!
//! ⚠️ COMPILE NOTE — like `matrix.rs`, this is the correct *shape* of the layer
//! and has not been compiled in CI. Spots needing a real endpoint, model id, or
//! SDK call are marked `// VERIFY:` / `// TODO:`.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use ts_rs::TS;

use crate::matrix::MatrixState;

const SUMMARY_SYSTEM: &str = "You are an assistant embedded in a unified messaging \
inbox. Summarize the conversation in a few tight bullet points. Lead with anything \
that needs the user's reply or a decision. Be concise and never invent details.";

const QA_SYSTEM: &str = "You answer questions strictly from the provided chat \
context. If the answer is not in the context, say you don't know. Quote senders \
when useful. Do not fabricate.";

// ---------------------------------------------------------------------------
// Wire types (Rust <-> TS). `#[ts(export)]` regenerates the matching .ts file in
// ../src/bindings/ so the boundary can't silently drift. Regenerate via `cargo test`.
// ---------------------------------------------------------------------------

/// Which backend a provider points at. Used only for UI labelling / presets;
/// the transport is identical (OpenAI-compatible) for every variant today.
#[derive(Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/bindings/")]
pub enum AiProviderKind {
    /// Open model on AMD Developer Cloud (MI300X, ROCm + vLLM).
    AmdDevCloud,
    /// Qwen on Alibaba's Qwen Cloud (DashScope compatible-mode endpoint).
    QwenCloud,
    /// User's own DeepSeek API key.
    DeepSeek,
    /// User's own OpenAI API key.
    OpenAi,
    /// Any other OpenAI-compatible endpoint the user pastes in.
    Custom,
}

/// Provider configuration sent FROM the UI (settings screen → backend).
///
/// `api_key` is write-only: accepted here, but `ai_active_provider` never returns
/// it — see [`AiProviderInfo`]. That keeps the secret out of any rendered state.
#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/bindings/")]
pub struct AiProviderInput {
    pub kind: AiProviderKind,
    /// Human label shown in settings, e.g. "AMD MI300X (Qwen2.5-72B)".
    pub label: String,
    /// Base URL INCLUDING the version path, e.g. `https://.../compatible-mode/v1`.
    /// We append `/chat/completions` and `/embeddings`.
    pub base_url: String,
    /// Chat / instruct model id served at `base_url`.
    pub model: String,
    /// Embedding model id, for RAG Q&A and the image hub. Optional until those land.
    pub embed_model: Option<String>,
    /// Bearer token. `None` for a keyless local endpoint (e.g. self-hosted vLLM).
    pub api_key: Option<String>,
}

/// Provider info returned TO the UI. Note: no `api_key` — only whether one is set.
#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/bindings/")]
pub struct AiProviderInfo {
    pub kind: AiProviderKind,
    pub label: String,
    pub model: String,
    /// True when a non-empty key is configured (lets the UI show "configured"
    /// without ever receiving the secret).
    pub has_key: bool,
}

/// A grounded answer for cross-network Q&A.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/bindings/")]
pub struct AiAnswer {
    pub text: String,
    /// Room/message ids the answer drew on — the seed of real citations once RAG
    /// retrieval lands. For now, the rooms we pulled context from.
    pub sources: Vec<String>,
}

/// One chat turn in OpenAI shape. Internal — never crosses to the frontend.
#[derive(Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

// ---------------------------------------------------------------------------
// Provider trait + the one OpenAI-compatible implementation.
// ---------------------------------------------------------------------------

/// The capability surface every backend must offer. Async via `async_trait`
/// because trait async fns aren't stable across our MSRV yet.
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Run a chat completion and return the assistant's text.
    async fn complete(&self, messages: Vec<ChatMessage>) -> Result<String, String>;
    /// Embed inputs (for RAG / image-hub search). Errs if no embed model is set.
    async fn embed(&self, inputs: Vec<String>) -> Result<Vec<Vec<f32>>, String>;
}

/// Talks to any OpenAI-compatible endpoint (AMD vLLM, Qwen Cloud, DeepSeek, OpenAI).
struct OpenAiCompatProvider {
    http: reqwest::Client,
    base_url: String,
    model: String,
    embed_model: Option<String>,
    api_key: Option<String>,
}

impl OpenAiCompatProvider {
    fn from_config(cfg: &AiProviderInput) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: cfg.base_url.trim_end_matches('/').to_string(),
            model: cfg.model.clone(),
            embed_model: cfg.embed_model.clone(),
            api_key: cfg.api_key.clone(),
        }
    }
}

#[async_trait]
impl AiProvider for OpenAiCompatProvider {
    async fn complete(&self, messages: Vec<ChatMessage>) -> Result<String, String> {
        #[derive(Serialize)]
        struct Req<'a> {
            model: &'a str,
            messages: &'a [ChatMessage],
            temperature: f32,
        }
        #[derive(Deserialize)]
        struct Choice {
            message: ChatMessage,
        }
        #[derive(Deserialize)]
        struct Resp {
            choices: Vec<Choice>,
        }

        let url = format!("{}/chat/completions", self.base_url);
        let mut req = self.http.post(&url).json(&Req {
            model: &self.model,
            messages: &messages,
            temperature: 0.3,
        });
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("model endpoint returned {status}: {body}"));
        }
        let parsed: Resp = resp.json().await.map_err(|e| e.to_string())?;
        parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| "model returned no choices".to_string())
    }

    async fn embed(&self, inputs: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        let model = self
            .embed_model
            .as_ref()
            .ok_or("no embedding model configured for this provider")?;

        #[derive(Serialize)]
        struct Req<'a> {
            model: &'a str,
            input: &'a [String],
        }
        #[derive(Deserialize)]
        struct Item {
            embedding: Vec<f32>,
        }
        #[derive(Deserialize)]
        struct Resp {
            data: Vec<Item>,
        }

        let url = format!("{}/embeddings", self.base_url);
        let mut req = self.http.post(&url).json(&Req { model, input: &inputs });
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("embedding endpoint returned {status}: {body}"));
        }
        let parsed: Resp = resp.json().await.map_err(|e| e.to_string())?;
        Ok(parsed.data.into_iter().map(|i| i.embedding).collect())
    }
}

// ---------------------------------------------------------------------------
// State + command surface (the Rust <-> TS boundary).
// ---------------------------------------------------------------------------

/// Holds the currently-selected provider config. Single active provider for now;
/// becomes a map if we ever let different features use different backends.
#[derive(Default)]
pub struct AiState {
    provider: Arc<RwLock<Option<AiProviderInput>>>,
}

/// Build a live provider from whatever is configured, or error helpfully.
async fn active_provider(ai: &AiState) -> Result<OpenAiCompatProvider, String> {
    let guard = ai.provider.read().await;
    let cfg = guard
        .as_ref()
        .ok_or("no AI provider configured — set one in Settings")?;
    Ok(OpenAiCompatProvider::from_config(cfg))
}

/// Render chat lines into a transcript for prompting.
fn transcript(lines: &[crate::matrix::ChatLine]) -> String {
    lines
        .iter()
        .map(|l| format!("{}: {}", l.sender, l.body))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Store/replace the active AI provider (called from the settings screen).
#[tauri::command]
pub async fn ai_set_provider(
    ai: tauri::State<'_, AiState>,
    config: AiProviderInput,
) -> Result<(), String> {
    *ai.provider.write().await = Some(config);
    Ok(())
}

/// Report the active provider WITHOUT leaking the API key.
#[tauri::command]
pub async fn ai_active_provider(
    ai: tauri::State<'_, AiState>,
) -> Result<Option<AiProviderInfo>, String> {
    let guard = ai.provider.read().await;
    Ok(guard.as_ref().map(|c| AiProviderInfo {
        kind: c.kind.clone(),
        label: c.label.clone(),
        model: c.model.clone(),
        has_key: c.api_key.as_deref().is_some_and(|k| !k.is_empty()),
    }))
}

/// Summarize a single room. Works for bridged WhatsApp/IG rooms too, since the
/// bridge writes ordinary `m.room.message` events into the Matrix timeline.
#[tauri::command]
pub async fn ai_summarize_room(
    ai: tauri::State<'_, AiState>,
    mx: tauri::State<'_, MatrixState>,
    room_id: String,
) -> Result<String, String> {
    let provider = active_provider(&ai).await?;
    let lines = mx.recent_messages(&room_id, 50).await?;
    if lines.is_empty() {
        return Ok("No recent messages to summarize.".to_string());
    }

    let messages = vec![
        ChatMessage { role: "system".into(), content: SUMMARY_SYSTEM.into() },
        ChatMessage {
            role: "user".into(),
            content: format!("Summarize this chat:\n\n{}", transcript(&lines)),
        },
    ];
    provider.complete(messages).await
}

/// Ask a question grounded in chat context.
///
/// SCOPE: real cross-network RAG (embed all messages → vector search → top-k) is
/// the next AI task and is what makes whole-inbox Q&A work. This scaffold does the
/// simpler "stuff one room's recent context" path so the end-to-end shape is live
/// and demoable. Whole-inbox retrieval is the `room_id == None` TODO below.
#[tauri::command]
pub async fn ai_ask(
    ai: tauri::State<'_, AiState>,
    mx: tauri::State<'_, MatrixState>,
    question: String,
    room_id: Option<String>,
) -> Result<AiAnswer, String> {
    let provider = active_provider(&ai).await?;

    // TODO(rag): when room_id is None, retrieve top-k across ALL rooms via the
    // embedding index instead of erroring. Tracked as the RAG milestone.
    let room = room_id
        .ok_or("whole-inbox Q&A needs the RAG index (not built yet) — pass a room_id for now")?;

    let lines = mx.recent_messages(&room, 80).await?;
    let messages = vec![
        ChatMessage { role: "system".into(), content: QA_SYSTEM.into() },
        ChatMessage {
            role: "user".into(),
            content: format!("Context:\n{}\n\nQuestion: {question}", transcript(&lines)),
        },
    ];
    let text = provider.complete(messages).await?;
    Ok(AiAnswer { text, sources: vec![room] })
}
