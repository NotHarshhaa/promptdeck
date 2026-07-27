from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

app = FastAPI(
    title="PromptDeck API",
    version="0.2.0",
    description="A local prompt engineering control plane with optional live provider execution.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for env_directory in (Path.cwd(), *Path(__file__).resolve().parents):
    load_dotenv(env_directory / ".env")

DB_PATH = Path(os.getenv("PROMPTDECK_DB_PATH", "./data/promptdeck.db"))


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    name: str
    model: str
    live_model: str
    color: str
    env_key: str | None = None
    api_base_env: str | None = None

    def is_configured(self) -> bool:
        if self.env_key:
            return bool(os.getenv(self.env_key))
        if self.api_base_env:
            return bool(os.getenv(self.api_base_env))
        return False


PROVIDER_SPECS = (
    ProviderSpec("openai", "OpenAI", "gpt-4o", "gpt-4o", "#5eead4", "OPENAI_API_KEY"),
    ProviderSpec(
        "anthropic",
        "Anthropic",
        "claude-3-5-sonnet",
        "anthropic/claude-3-5-sonnet-latest",
        "#f6ad7b",
        "ANTHROPIC_API_KEY",
    ),
    ProviderSpec(
        "google",
        "Google AI",
        "gemini-1.5-pro",
        "gemini/gemini-1.5-pro",
        "#8ab4f8",
        "GEMINI_API_KEY",
    ),
    ProviderSpec(
        "groq",
        "Groq",
        "llama-3.3-70b",
        "groq/llama-3.3-70b-versatile",
        "#fb7185",
        "GROQ_API_KEY",
    ),
    ProviderSpec("ollama", "Ollama", "llama3.2", "ollama/llama3.2", "#cbd5e1", api_base_env="OLLAMA_BASE_URL"),
)
PROVIDER_BY_ID = {provider.id: provider for provider in PROVIDER_SPECS}


class Provider(BaseModel):
    id: str
    name: str
    model: str
    live_model: str
    color: str
    configured: bool
    status: Literal["ready", "not_configured"]
    required_env: str | None = None


class Message(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    model: str | None = None
    created_at: datetime


class Conversation(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[Message] = Field(default_factory=list)


class ConversationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class RunMetric(BaseModel):
    id: str
    conversation_id: str
    provider: str
    model: str
    mode: Literal["demo", "live"]
    status: Literal["complete", "error"]
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float | None = None
    token_source: Literal["estimated", "provider"] = "estimated"
    created_at: datetime


class MetricsSummary(BaseModel):
    total_runs: int
    completed_runs: int
    total_tokens: int
    average_latency_ms: int
    total_cost_usd: float | None


class ChatRequest(BaseModel):
    provider: str = "openai"
    model: str = "gpt-4o"
    prompt: str = Field(min_length=1, max_length=50_000)
    system_prompt: str = "You are a helpful assistant."
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=16_384)
    mode: Literal["demo", "live"] = "demo"
    conversation_id: str | None = None


def now() -> datetime:
    return datetime.now(UTC)


def now_string() -> str:
    return now().isoformat()


def db_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with db_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              model TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              provider TEXT NOT NULL,
              model TEXT NOT NULL,
              mode TEXT NOT NULL,
              status TEXT NOT NULL,
              latency_ms INTEGER NOT NULL,
              prompt_tokens INTEGER NOT NULL,
              completion_tokens INTEGER NOT NULL,
              cost_usd REAL,
              token_source TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
            CREATE INDEX IF NOT EXISTS conversations_updated_at ON conversations(updated_at DESC);
            CREATE INDEX IF NOT EXISTS messages_conversation_id ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS runs_conversation_id ON runs(conversation_id, created_at DESC);
            """
        )


def to_provider(spec: ProviderSpec) -> Provider:
    configured = spec.is_configured()
    return Provider(
        id=spec.id,
        name=spec.name,
        model=spec.model,
        live_model=spec.live_model,
        color=spec.color,
        configured=configured,
        status="ready" if configured else "not_configured",
        required_env=spec.env_key or spec.api_base_env,
    )


def row_to_message(row: sqlite3.Row) -> Message:
    return Message(
        id=row["id"],
        role=row["role"],
        content=row["content"],
        model=row["model"],
        created_at=row["created_at"],
    )


def row_to_conversation(row: sqlite3.Row, messages: list[Message] | None = None) -> Conversation:
    return Conversation(
        id=row["id"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        messages=messages or [],
    )


def row_to_run(row: sqlite3.Row) -> RunMetric:
    return RunMetric(
        id=row["id"],
        conversation_id=row["conversation_id"],
        provider=row["provider"],
        model=row["model"],
        mode=row["mode"],
        status=row["status"],
        latency_ms=row["latency_ms"],
        prompt_tokens=row["prompt_tokens"],
        completion_tokens=row["completion_tokens"],
        cost_usd=row["cost_usd"],
        token_source=row["token_source"],
        created_at=row["created_at"],
    )


def create_conversation_record(title: str) -> Conversation:
    created_at = now_string()
    conversation = Conversation(id=str(uuid4()), title=title, created_at=created_at, updated_at=created_at)
    with db_connection() as connection:
        connection.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (conversation.id, conversation.title, created_at, created_at),
        )
    return conversation


def get_conversation_record(conversation_id: str, include_messages: bool = True) -> Conversation | None:
    with db_connection() as connection:
        conversation_row = connection.execute(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        if conversation_row is None:
            return None
        messages: list[Message] = []
        if include_messages:
            message_rows = connection.execute(
                "SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at",
                (conversation_id,),
            ).fetchall()
            messages = [row_to_message(row) for row in message_rows]
    return row_to_conversation(conversation_row, messages)


def persist_message(conversation_id: str, role: Literal["user", "assistant", "system"], content: str, model: str | None = None) -> Message:
    message = Message(id=str(uuid4()), role=role, content=content, model=model, created_at=now_string())
    with db_connection() as connection:
        connection.execute(
            "INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (message.id, conversation_id, message.role, message.content, message.model, message.created_at.isoformat()),
        )
        connection.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now_string(), conversation_id))
    return message


def persist_run(
    conversation_id: str,
    request: ChatRequest,
    status: Literal["complete", "error"],
    latency_ms: int,
    prompt_tokens: int,
    completion_tokens: int,
    token_source: Literal["estimated", "provider"] = "estimated",
    cost_usd: float | None = None,
) -> RunMetric:
    run = RunMetric(
        id=str(uuid4()),
        conversation_id=conversation_id,
        provider=request.provider,
        model=request.model,
        mode=request.mode,
        status=status,
        latency_ms=latency_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=cost_usd,
        token_source=token_source,
        created_at=now_string(),
    )
    with db_connection() as connection:
        connection.execute(
            """INSERT INTO runs
              (id, conversation_id, provider, model, mode, status, latency_ms, prompt_tokens, completion_tokens, cost_usd, token_source, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run.id,
                run.conversation_id,
                run.provider,
                run.model,
                run.mode,
                run.status,
                run.latency_ms,
                run.prompt_tokens,
                run.completion_tokens,
                run.cost_usd,
                run.token_source,
                run.created_at.isoformat(),
            ),
        )
    return run


def estimate_tokens(text: str) -> int:
    return max(1, round(len(text) / 4)) if text else 0


def create_demo_reply(request: ChatRequest) -> str:
    subject = request.prompt.strip().replace("\n", " ")
    if len(subject) > 140:
        subject = f"{subject[:137]}..."
    return (
        f"Signal received. Here is a practical response for: **{subject}**\n\n"
        "01 — Establish a safe baseline: define clear resource limits, probes, and a rollback boundary before changing traffic.\n"
        "02 — Instrument the path: measure latency, saturation, errors, and the deployment version in one view.\n"
        "03 — Add failure tolerance: spread replicas, protect disruptions, and test the dependency-timeout path.\n\n"
        f"This is a deterministic **demo run**. Switch to Live mode after configuring {request.provider} to send this exact prompt, system instruction, temperature, and token cap to a real model."
    )


def sse(payload: dict[str, Any], event_type: str = "message") -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"


async def demo_chunks(request: ChatRequest) -> AsyncIterator[str]:
    for word in create_demo_reply(request).split(" "):
        yield f"{word} "
        await asyncio.sleep(0.012)


async def live_chunks(request: ChatRequest, spec: ProviderSpec, usage_state: dict[str, Any]) -> AsyncIterator[str]:
    try:
        from litellm import acompletion
    except ImportError as error:  # pragma: no cover - requirements install covers this
        raise RuntimeError("LiteLLM is not installed. Run pip install -r requirements.txt.") from error

    parameters: dict[str, Any] = {
        "model": spec.live_model,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": request.prompt},
        ],
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if spec.api_base_env:
        parameters["api_base"] = os.environ[spec.api_base_env]

    response = await acompletion(**parameters)
    async for chunk in response:
        usage = getattr(chunk, "usage", None)
        if usage:
            usage_state["prompt_tokens"] = getattr(usage, "prompt_tokens", None) or usage.get("prompt_tokens")
            usage_state["completion_tokens"] = getattr(usage, "completion_tokens", None) or usage.get("completion_tokens")
        choices = getattr(chunk, "choices", [])
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        content = getattr(delta, "content", None) if delta else None
        if content:
            yield content


async def stream_response(request: ChatRequest, conversation: Conversation, spec: ProviderSpec) -> AsyncIterator[str]:
    started_at = time.perf_counter()
    text = ""
    usage_state: dict[str, Any] = {}
    try:
        source = demo_chunks(request) if request.mode == "demo" else live_chunks(request, spec, usage_state)
        async for token in source:
            text += token
            yield sse({"type": "token", "content": token})

        assistant_message = persist_message(conversation.id, "assistant", text.strip(), request.model)
        latency_ms = round((time.perf_counter() - started_at) * 1000)
        provider_usage = bool(usage_state.get("prompt_tokens") is not None)
        metrics = persist_run(
            conversation.id,
            request,
            "complete",
            latency_ms,
            int(usage_state.get("prompt_tokens") or estimate_tokens(f"{request.system_prompt} {request.prompt}")),
            int(usage_state.get("completion_tokens") or estimate_tokens(text)),
            "provider" if provider_usage else "estimated",
        )
        yield sse(
            {
                "type": "complete",
                "conversation_id": conversation.id,
                "title": conversation.title,
                "message_id": assistant_message.id,
                "metrics": metrics.model_dump(mode="json"),
            }
        )
    except Exception as error:
        latency_ms = round((time.perf_counter() - started_at) * 1000)
        persist_run(
            conversation.id,
            request,
            "error",
            latency_ms,
            estimate_tokens(f"{request.system_prompt} {request.prompt}"),
            estimate_tokens(text),
        )
        yield sse({"type": "error", "message": str(error) or "The provider run failed."})


initialize_database()


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "promptdeck-api", "database": str(DB_PATH)}


@app.get("/api/providers", response_model=list[Provider], tags=["providers"])
def list_providers() -> list[Provider]:
    return [to_provider(spec) for spec in PROVIDER_SPECS]


@app.get("/api/metrics/summary", response_model=MetricsSummary, tags=["metrics"])
def metrics_summary() -> MetricsSummary:
    with db_connection() as connection:
        row = connection.execute(
            """SELECT COUNT(*) AS total_runs,
                      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS completed_runs,
                      COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
                      COALESCE(AVG(latency_ms), 0) AS average_latency_ms,
                      SUM(cost_usd) AS total_cost_usd
               FROM runs"""
        ).fetchone()
    return MetricsSummary(
        total_runs=row["total_runs"],
        completed_runs=row["completed_runs"],
        total_tokens=row["total_tokens"],
        average_latency_ms=round(row["average_latency_ms"]),
        total_cost_usd=row["total_cost_usd"],
    )


@app.get("/api/conversations", response_model=list[Conversation], tags=["conversations"])
def list_conversations() -> list[Conversation]:
    with db_connection() as connection:
        rows = connection.execute(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50"
        ).fetchall()
    return [row_to_conversation(row) for row in rows]


@app.post("/api/conversations", response_model=Conversation, status_code=201, tags=["conversations"])
def create_conversation(payload: ConversationCreate) -> Conversation:
    return create_conversation_record(payload.title)


@app.get("/api/conversations/{conversation_id}", response_model=Conversation, tags=["conversations"])
def get_conversation(conversation_id: str) -> Conversation:
    conversation = get_conversation_record(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/chat/stream", tags=["chat"])
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    spec = PROVIDER_BY_ID.get(request.provider)
    if spec is None:
        raise HTTPException(status_code=422, detail=f"Unknown provider: {request.provider}")
    if request.mode == "live" and not spec.is_configured():
        required = spec.env_key or spec.api_base_env
        raise HTTPException(
            status_code=409,
            detail=f"{spec.name} is not configured. Set {required} in your environment and restart the API.",
        )

    if request.conversation_id:
        conversation = get_conversation_record(request.conversation_id, include_messages=False)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        title = request.prompt.strip().split("\n", maxsplit=1)[0][:72] or "Untitled playground"
        conversation = create_conversation_record(title)

    persist_message(conversation.id, "system", request.system_prompt)
    persist_message(conversation.id, "user", request.prompt)
    return StreamingResponse(
        stream_response(request, conversation, spec),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
