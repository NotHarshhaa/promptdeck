from __future__ import annotations

import asyncio
import csv
import html
import io
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
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import Response, StreamingResponse

app = FastAPI(
    title="PromptDeck API",
    version="0.3.0",
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
    ProviderSpec("anthropic", "Anthropic", "claude-3-5-sonnet", "anthropic/claude-3-5-sonnet-latest", "#f6ad7b", "ANTHROPIC_API_KEY"),
    ProviderSpec("google", "Google AI", "gemini-1.5-pro", "gemini/gemini-1.5-pro", "#8ab4f8", "GEMINI_API_KEY"),
    ProviderSpec("groq", "Groq", "llama-3.3-70b", "groq/llama-3.3-70b-versatile", "#fb7185", "GROQ_API_KEY"),
    ProviderSpec("ollama", "Ollama", "llama3.2", "ollama/llama3.2", "#cbd5e1", api_base_env="OLLAMA_BASE_URL"),
)
PROVIDER_BY_ID = {provider.id: provider for provider in PROVIDER_SPECS}

# USD per one million tokens. These are used only where a model's public price is known;
# the API keeps unknown/local model costs as null instead of inventing a value.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o": (2.50, 10.00),
    "claude-3-5-sonnet": (3.00, 15.00),
    "gemini-1.5-pro": (3.50, 10.50),
    "llama-3.3-70b": (0.59, 0.79),
}


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


class PromptRevision(BaseModel):
    id: str
    prompt_id: str
    version: int
    content: str
    system_prompt: str
    change_note: str | None = None
    created_at: datetime


class PromptTemplate(BaseModel):
    id: str
    title: str
    description: str
    category: str
    tags: list[str] = Field(default_factory=list)
    content: str
    system_prompt: str
    latest_version: int
    created_at: datetime
    updated_at: datetime
    revisions: list[PromptRevision] = Field(default_factory=list)


class PromptTemplateCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    category: str = Field(default="General", min_length=1, max_length=80)
    tags: list[str] = Field(default_factory=list, max_length=12)
    content: str = Field(min_length=1, max_length=50_000)
    system_prompt: str = Field(default="You are a helpful assistant.", max_length=20_000)
    change_note: str | None = Field(default="Initial version", max_length=300)


class PromptTemplateUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    tags: list[str] | None = Field(default=None, max_length=12)
    content: str | None = Field(default=None, min_length=1, max_length=50_000)
    system_prompt: str | None = Field(default=None, max_length=20_000)
    change_note: str | None = Field(default=None, max_length=300)


class ComparisonTarget(BaseModel):
    provider: str
    model: str = Field(min_length=1, max_length=180)


class ComparisonResult(BaseModel):
    id: str
    comparison_id: str
    provider: str
    model: str
    response: str
    status: Literal["complete", "error"]
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float | None
    token_source: Literal["estimated", "provider"]
    error: str | None = None
    created_at: datetime


class Comparison(BaseModel):
    id: str
    title: str
    prompt: str
    system_prompt: str
    mode: Literal["demo", "live"]
    created_at: datetime
    results: list[ComparisonResult] = Field(default_factory=list)


class ComparisonCreate(BaseModel):
    title: str = Field(default="Model comparison", min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=50_000)
    system_prompt: str = Field(default="You are a helpful assistant.", max_length=20_000)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=16_384)
    mode: Literal["demo", "live"] = "demo"
    targets: list[ComparisonTarget] = Field(min_length=2, max_length=5)


class EvaluationAssertion(BaseModel):
    type: Literal["contains", "not_contains", "equals", "json_valid", "max_length"]
    value: str | None = Field(default=None, max_length=5_000)


class EvaluationResult(BaseModel):
    id: str
    evaluation_id: str
    assertion_type: str
    expected: str | None
    passed: bool
    detail: str


class Evaluation(BaseModel):
    id: str
    title: str
    input: str
    output: str
    passed: bool
    created_at: datetime
    results: list[EvaluationResult] = Field(default_factory=list)


class EvaluationCreate(BaseModel):
    title: str = Field(default="Response evaluation", min_length=1, max_length=120)
    input: str = Field(default="", max_length=50_000)
    output: str = Field(min_length=1, max_length=100_000)
    assertions: list[EvaluationAssertion] = Field(min_length=1, max_length=20)


class CostBreakdown(BaseModel):
    provider: str
    model: str
    runs: int
    tokens: int
    total_cost_usd: float | None
    average_latency_ms: int


class CostAnalytics(BaseModel):
    total_runs: int
    total_tokens: int
    total_cost_usd: float | None
    by_model: list[CostBreakdown]


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
            CREATE TABLE IF NOT EXISTS prompt_templates (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              category TEXT NOT NULL,
              tags_json TEXT NOT NULL,
              content TEXT NOT NULL,
              system_prompt TEXT NOT NULL,
              latest_version INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS prompt_revisions (
              id TEXT PRIMARY KEY,
              prompt_id TEXT NOT NULL,
              version INTEGER NOT NULL,
              content TEXT NOT NULL,
              system_prompt TEXT NOT NULL,
              change_note TEXT,
              created_at TEXT NOT NULL,
              UNIQUE(prompt_id, version),
              FOREIGN KEY(prompt_id) REFERENCES prompt_templates(id)
            );
            CREATE TABLE IF NOT EXISTS comparisons (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              prompt TEXT NOT NULL,
              system_prompt TEXT NOT NULL,
              mode TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS comparison_results (
              id TEXT PRIMARY KEY,
              comparison_id TEXT NOT NULL,
              provider TEXT NOT NULL,
              model TEXT NOT NULL,
              response TEXT NOT NULL,
              status TEXT NOT NULL,
              latency_ms INTEGER NOT NULL,
              prompt_tokens INTEGER NOT NULL,
              completion_tokens INTEGER NOT NULL,
              cost_usd REAL,
              token_source TEXT NOT NULL,
              error TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(comparison_id) REFERENCES comparisons(id)
            );
            CREATE TABLE IF NOT EXISTS evaluations (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              input TEXT NOT NULL,
              output TEXT NOT NULL,
              passed INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS evaluation_results (
              id TEXT PRIMARY KEY,
              evaluation_id TEXT NOT NULL,
              assertion_type TEXT NOT NULL,
              expected TEXT,
              passed INTEGER NOT NULL,
              detail TEXT NOT NULL,
              FOREIGN KEY(evaluation_id) REFERENCES evaluations(id)
            );
            CREATE INDEX IF NOT EXISTS conversations_updated_at ON conversations(updated_at DESC);
            CREATE INDEX IF NOT EXISTS messages_conversation_id ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS runs_conversation_id ON runs(conversation_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS prompt_revisions_prompt_id ON prompt_revisions(prompt_id, version DESC);
            CREATE INDEX IF NOT EXISTS comparison_results_comparison_id ON comparison_results(comparison_id);
            CREATE INDEX IF NOT EXISTS evaluations_created_at ON evaluations(created_at DESC);
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
    return Message(id=row["id"], role=row["role"], content=row["content"], model=row["model"], created_at=row["created_at"])


def row_to_conversation(row: sqlite3.Row, messages: list[Message] | None = None) -> Conversation:
    return Conversation(id=row["id"], title=row["title"], created_at=row["created_at"], updated_at=row["updated_at"], messages=messages or [])


def row_to_run(row: sqlite3.Row) -> RunMetric:
    return RunMetric(
        id=row["id"], conversation_id=row["conversation_id"], provider=row["provider"], model=row["model"], mode=row["mode"],
        status=row["status"], latency_ms=row["latency_ms"], prompt_tokens=row["prompt_tokens"], completion_tokens=row["completion_tokens"],
        cost_usd=row["cost_usd"], token_source=row["token_source"], created_at=row["created_at"],
    )


def row_to_revision(row: sqlite3.Row) -> PromptRevision:
    return PromptRevision(id=row["id"], prompt_id=row["prompt_id"], version=row["version"], content=row["content"], system_prompt=row["system_prompt"], change_note=row["change_note"], created_at=row["created_at"])


def row_to_prompt(row: sqlite3.Row, revisions: list[PromptRevision] | None = None) -> PromptTemplate:
    return PromptTemplate(
        id=row["id"], title=row["title"], description=row["description"], category=row["category"], tags=json.loads(row["tags_json"]),
        content=row["content"], system_prompt=row["system_prompt"], latest_version=row["latest_version"], created_at=row["created_at"],
        updated_at=row["updated_at"], revisions=revisions or [],
    )


def row_to_comparison_result(row: sqlite3.Row) -> ComparisonResult:
    return ComparisonResult(
        id=row["id"], comparison_id=row["comparison_id"], provider=row["provider"], model=row["model"], response=row["response"],
        status=row["status"], latency_ms=row["latency_ms"], prompt_tokens=row["prompt_tokens"], completion_tokens=row["completion_tokens"],
        cost_usd=row["cost_usd"], token_source=row["token_source"], error=row["error"], created_at=row["created_at"],
    )


def row_to_evaluation_result(row: sqlite3.Row) -> EvaluationResult:
    return EvaluationResult(id=row["id"], evaluation_id=row["evaluation_id"], assertion_type=row["assertion_type"], expected=row["expected"], passed=bool(row["passed"]), detail=row["detail"])


def estimate_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    rates = MODEL_PRICES.get(model)
    if rates is None:
        return None
    return round((prompt_tokens * rates[0] + completion_tokens * rates[1]) / 1_000_000, 8)


def create_conversation_record(title: str) -> Conversation:
    created_at = now_string()
    conversation = Conversation(id=str(uuid4()), title=title, created_at=created_at, updated_at=created_at)
    with db_connection() as connection:
        connection.execute("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", (conversation.id, conversation.title, created_at, created_at))
    return conversation


def get_conversation_record(conversation_id: str, include_messages: bool = True) -> Conversation | None:
    with db_connection() as connection:
        conversation_row = connection.execute("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if conversation_row is None:
            return None
        messages: list[Message] = []
        if include_messages:
            rows = connection.execute("SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at", (conversation_id,)).fetchall()
            messages = [row_to_message(row) for row in rows]
    return row_to_conversation(conversation_row, messages)


def persist_message(conversation_id: str, role: Literal["user", "assistant", "system"], content: str, model: str | None = None) -> Message:
    message = Message(id=str(uuid4()), role=role, content=content, model=model, created_at=now_string())
    with db_connection() as connection:
        connection.execute("INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)", (message.id, conversation_id, message.role, message.content, message.model, message.created_at.isoformat()))
        connection.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now_string(), conversation_id))
    return message


def persist_run(conversation_id: str, request: ChatRequest, status: Literal["complete", "error"], latency_ms: int, prompt_tokens: int, completion_tokens: int, token_source: Literal["estimated", "provider"] = "estimated", cost_usd: float | None = None) -> RunMetric:
    calculated_cost = cost_usd if cost_usd is not None else estimate_cost_usd(request.model, prompt_tokens, completion_tokens)
    run = RunMetric(id=str(uuid4()), conversation_id=conversation_id, provider=request.provider, model=request.model, mode=request.mode, status=status, latency_ms=latency_ms, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, cost_usd=calculated_cost, token_source=token_source, created_at=now_string())
    with db_connection() as connection:
        connection.execute(
            """INSERT INTO runs (id, conversation_id, provider, model, mode, status, latency_ms, prompt_tokens, completion_tokens, cost_usd, token_source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (run.id, run.conversation_id, run.provider, run.model, run.mode, run.status, run.latency_ms, run.prompt_tokens, run.completion_tokens, run.cost_usd, run.token_source, run.created_at.isoformat()),
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
    except ImportError as error:  # pragma: no cover
        raise RuntimeError("LiteLLM is not installed. Run pip install -r requirements.txt.") from error

    parameters: dict[str, Any] = {
        "model": spec.live_model,
        "messages": [{"role": "system", "content": request.system_prompt}, {"role": "user", "content": request.prompt}],
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
        if choices:
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
        provider_usage = usage_state.get("prompt_tokens") is not None
        metrics = persist_run(conversation.id, request, "complete", latency_ms, int(usage_state.get("prompt_tokens") or estimate_tokens(f"{request.system_prompt} {request.prompt}")), int(usage_state.get("completion_tokens") or estimate_tokens(text)), "provider" if provider_usage else "estimated")
        yield sse({"type": "complete", "conversation_id": conversation.id, "title": conversation.title, "message_id": assistant_message.id, "metrics": metrics.model_dump(mode="json")})
    except Exception as error:
        latency_ms = round((time.perf_counter() - started_at) * 1000)
        persist_run(conversation.id, request, "error", latency_ms, estimate_tokens(f"{request.system_prompt} {request.prompt}"), estimate_tokens(text))
        yield sse({"type": "error", "message": str(error) or "The provider run failed."})


def get_prompt_record(prompt_id: str, include_revisions: bool = True) -> PromptTemplate | None:
    with db_connection() as connection:
        row = connection.execute("SELECT * FROM prompt_templates WHERE id = ?", (prompt_id,)).fetchone()
        if row is None:
            return None
        revisions: list[PromptRevision] = []
        if include_revisions:
            revision_rows = connection.execute("SELECT * FROM prompt_revisions WHERE prompt_id = ? ORDER BY version DESC", (prompt_id,)).fetchall()
            revisions = [row_to_revision(revision) for revision in revision_rows]
    return row_to_prompt(row, revisions)


def append_prompt_revision(connection: sqlite3.Connection, prompt_id: str, version: int, content: str, system_prompt: str, change_note: str | None) -> None:
    connection.execute("INSERT INTO prompt_revisions (id, prompt_id, version, content, system_prompt, change_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (str(uuid4()), prompt_id, version, content, system_prompt, change_note, now_string()))


async def run_comparison_target(comparison_id: str, payload: ComparisonCreate, target: ComparisonTarget) -> ComparisonResult:
    spec = PROVIDER_BY_ID[target.provider]
    request = ChatRequest(provider=target.provider, model=target.model, prompt=payload.prompt, system_prompt=payload.system_prompt, temperature=payload.temperature, max_tokens=payload.max_tokens, mode=payload.mode)
    started_at = time.perf_counter()
    usage_state: dict[str, Any] = {}
    text = ""
    try:
        source = demo_chunks(request) if payload.mode == "demo" else live_chunks(request, spec, usage_state)
        async for token in source:
            text += token
        prompt_tokens = int(usage_state.get("prompt_tokens") or estimate_tokens(f"{payload.system_prompt} {payload.prompt}"))
        completion_tokens = int(usage_state.get("completion_tokens") or estimate_tokens(text))
        return ComparisonResult(id=str(uuid4()), comparison_id=comparison_id, provider=target.provider, model=target.model, response=text.strip(), status="complete", latency_ms=round((time.perf_counter() - started_at) * 1000), prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, cost_usd=estimate_cost_usd(target.model, prompt_tokens, completion_tokens), token_source="provider" if usage_state.get("prompt_tokens") is not None else "estimated", created_at=now_string())
    except Exception as error:
        return ComparisonResult(id=str(uuid4()), comparison_id=comparison_id, provider=target.provider, model=target.model, response=text.strip(), status="error", latency_ms=round((time.perf_counter() - started_at) * 1000), prompt_tokens=estimate_tokens(f"{payload.system_prompt} {payload.prompt}"), completion_tokens=estimate_tokens(text), cost_usd=None, token_source="estimated", error=str(error) or "Provider execution failed.", created_at=now_string())


def evaluate_assertion(output: str, assertion: EvaluationAssertion) -> tuple[bool, str]:
    if assertion.type == "contains":
        expected = assertion.value or ""
        return expected in output, f"Response {'contains' if expected in output else 'does not contain'} {expected!r}."
    if assertion.type == "not_contains":
        expected = assertion.value or ""
        return expected not in output, f"Response {'does not contain' if expected not in output else 'contains'} {expected!r}."
    if assertion.type == "equals":
        expected = assertion.value or ""
        return output.strip() == expected.strip(), "Response matches expected text." if output.strip() == expected.strip() else "Response differs from expected text."
    if assertion.type == "json_valid":
        try:
            json.loads(output)
            return True, "Response is valid JSON."
        except json.JSONDecodeError as error:
            return False, f"Response is not valid JSON: {error.msg}."
    try:
        maximum = int(assertion.value or "")
    except ValueError:
        return False, "max_length requires an integer value."
    return len(output) <= maximum, f"Response length is {len(output)} characters (limit {maximum})."


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
        row = connection.execute("""SELECT COUNT(*) AS total_runs, COALESCE(SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END), 0) AS completed_runs, COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens, COALESCE(AVG(latency_ms), 0) AS average_latency_ms, SUM(cost_usd) AS total_cost_usd FROM runs""").fetchone()
    return MetricsSummary(total_runs=row["total_runs"], completed_runs=row["completed_runs"], total_tokens=row["total_tokens"], average_latency_ms=round(row["average_latency_ms"]), total_cost_usd=row["total_cost_usd"])


@app.get("/api/analytics/costs", response_model=CostAnalytics, tags=["analytics"])
def cost_analytics() -> CostAnalytics:
    with db_connection() as connection:
        rows = connection.execute("""SELECT provider, model, COUNT(*) AS runs, SUM(prompt_tokens + completion_tokens) AS tokens, SUM(cost_usd) AS total_cost_usd, AVG(latency_ms) AS average_latency_ms FROM (SELECT provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms FROM runs WHERE status = 'complete' UNION ALL SELECT provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms FROM comparison_results WHERE status = 'complete') GROUP BY provider, model ORDER BY total_cost_usd DESC, tokens DESC""").fetchall()
    breakdown = [CostBreakdown(provider=row["provider"], model=row["model"], runs=row["runs"], tokens=row["tokens"] or 0, total_cost_usd=row["total_cost_usd"], average_latency_ms=round(row["average_latency_ms"] or 0)) for row in rows]
    return CostAnalytics(total_runs=sum(item.runs for item in breakdown), total_tokens=sum(item.tokens for item in breakdown), total_cost_usd=round(sum(item.total_cost_usd or 0 for item in breakdown), 8) if any(item.total_cost_usd is not None for item in breakdown) else None, by_model=breakdown)


@app.get("/api/conversations", response_model=list[Conversation], tags=["conversations"])
def list_conversations() -> list[Conversation]:
    with db_connection() as connection:
        rows = connection.execute("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50").fetchall()
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
        raise HTTPException(status_code=409, detail=f"{spec.name} is not configured. Set {spec.env_key or spec.api_base_env} in your environment and restart the API.")
    if request.conversation_id:
        conversation = get_conversation_record(request.conversation_id, include_messages=False)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = create_conversation_record(request.prompt.strip().split("\n", maxsplit=1)[0][:72] or "Untitled playground")
    persist_message(conversation.id, "system", request.system_prompt)
    persist_message(conversation.id, "user", request.prompt)
    return StreamingResponse(stream_response(request, conversation, spec), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@app.get("/api/prompts", response_model=list[PromptTemplate], tags=["prompts"])
def list_prompts(search: str = Query(default="", max_length=120)) -> list[PromptTemplate]:
    query = f"%{search.strip()}%"
    with db_connection() as connection:
        rows = connection.execute("SELECT * FROM prompt_templates WHERE title LIKE ? OR description LIKE ? OR category LIKE ? ORDER BY updated_at DESC", (query, query, query)).fetchall()
    return [row_to_prompt(row) for row in rows]


@app.post("/api/prompts", response_model=PromptTemplate, status_code=201, tags=["prompts"])
def create_prompt(payload: PromptTemplateCreate) -> PromptTemplate:
    prompt_id, timestamp = str(uuid4()), now_string()
    tags = [tag.strip() for tag in payload.tags if tag.strip()]
    with db_connection() as connection:
        connection.execute("INSERT INTO prompt_templates (id, title, description, category, tags_json, content, system_prompt, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (prompt_id, payload.title.strip(), payload.description.strip(), payload.category.strip(), json.dumps(tags), payload.content, payload.system_prompt, 1, timestamp, timestamp))
        append_prompt_revision(connection, prompt_id, 1, payload.content, payload.system_prompt, payload.change_note)
    prompt = get_prompt_record(prompt_id)
    assert prompt is not None
    return prompt


@app.get("/api/prompts/{prompt_id}", response_model=PromptTemplate, tags=["prompts"])
def get_prompt(prompt_id: str) -> PromptTemplate:
    prompt = get_prompt_record(prompt_id)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt template not found")
    return prompt


@app.put("/api/prompts/{prompt_id}", response_model=PromptTemplate, tags=["prompts"])
def update_prompt(prompt_id: str, payload: PromptTemplateUpdate) -> PromptTemplate:
    current = get_prompt_record(prompt_id, include_revisions=False)
    if current is None:
        raise HTTPException(status_code=404, detail="Prompt template not found")
    fields = payload.model_dump(exclude_unset=True)
    content = fields.get("content", current.content)
    system_prompt = fields.get("system_prompt", current.system_prompt)
    changed_content = content != current.content or system_prompt != current.system_prompt
    next_version = current.latest_version + 1 if changed_content else current.latest_version
    tags = fields.get("tags", current.tags)
    with db_connection() as connection:
        connection.execute("UPDATE prompt_templates SET title = ?, description = ?, category = ?, tags_json = ?, content = ?, system_prompt = ?, latest_version = ?, updated_at = ? WHERE id = ?", (fields.get("title", current.title).strip(), fields.get("description", current.description).strip(), fields.get("category", current.category).strip(), json.dumps([tag.strip() for tag in tags if tag.strip()]), content, system_prompt, next_version, now_string(), prompt_id))
        if changed_content:
            append_prompt_revision(connection, prompt_id, next_version, content, system_prompt, fields.get("change_note") or "Updated prompt")
    updated = get_prompt_record(prompt_id)
    assert updated is not None
    return updated


@app.post("/api/prompts/{prompt_id}/revisions/{version}/restore", response_model=PromptTemplate, tags=["prompts"])
def restore_prompt_revision(prompt_id: str, version: int) -> PromptTemplate:
    current = get_prompt_record(prompt_id, include_revisions=False)
    if current is None:
        raise HTTPException(status_code=404, detail="Prompt template not found")
    with db_connection() as connection:
        revision = connection.execute("SELECT * FROM prompt_revisions WHERE prompt_id = ? AND version = ?", (prompt_id, version)).fetchone()
        if revision is None:
            raise HTTPException(status_code=404, detail="Prompt revision not found")
        next_version = current.latest_version + 1
        connection.execute("UPDATE prompt_templates SET content = ?, system_prompt = ?, latest_version = ?, updated_at = ? WHERE id = ?", (revision["content"], revision["system_prompt"], next_version, now_string(), prompt_id))
        append_prompt_revision(connection, prompt_id, next_version, revision["content"], revision["system_prompt"], f"Restored version {version}")
    restored = get_prompt_record(prompt_id)
    assert restored is not None
    return restored


@app.get("/api/comparisons", response_model=list[Comparison], tags=["comparisons"])
def list_comparisons() -> list[Comparison]:
    with db_connection() as connection:
        rows = connection.execute("SELECT * FROM comparisons ORDER BY created_at DESC LIMIT 25").fetchall()
        result_rows = connection.execute("SELECT * FROM comparison_results ORDER BY created_at").fetchall()
    results: dict[str, list[ComparisonResult]] = {}
    for row in result_rows:
        result = row_to_comparison_result(row)
        results.setdefault(result.comparison_id, []).append(result)
    return [Comparison(id=row["id"], title=row["title"], prompt=row["prompt"], system_prompt=row["system_prompt"], mode=row["mode"], created_at=row["created_at"], results=results.get(row["id"], [])) for row in rows]


@app.post("/api/comparisons", response_model=Comparison, status_code=201, tags=["comparisons"])
async def create_comparison(payload: ComparisonCreate) -> Comparison:
    unique_targets = {(target.provider, target.model) for target in payload.targets}
    if len(unique_targets) != len(payload.targets):
        raise HTTPException(status_code=422, detail="Each comparison target must be unique")
    for target in payload.targets:
        spec = PROVIDER_BY_ID.get(target.provider)
        if spec is None:
            raise HTTPException(status_code=422, detail=f"Unknown provider: {target.provider}")
        if payload.mode == "live" and not spec.is_configured():
            raise HTTPException(status_code=409, detail=f"{spec.name} is not configured for Live mode")
    comparison_id, timestamp = str(uuid4()), now_string()
    with db_connection() as connection:
        connection.execute("INSERT INTO comparisons (id, title, prompt, system_prompt, mode, created_at) VALUES (?, ?, ?, ?, ?, ?)", (comparison_id, payload.title.strip(), payload.prompt, payload.system_prompt, payload.mode, timestamp))
    results = await asyncio.gather(*(run_comparison_target(comparison_id, payload, target) for target in payload.targets))
    with db_connection() as connection:
        for result in results:
            connection.execute("INSERT INTO comparison_results (id, comparison_id, provider, model, response, status, latency_ms, prompt_tokens, completion_tokens, cost_usd, token_source, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (result.id, result.comparison_id, result.provider, result.model, result.response, result.status, result.latency_ms, result.prompt_tokens, result.completion_tokens, result.cost_usd, result.token_source, result.error, result.created_at.isoformat()))
    return Comparison(id=comparison_id, title=payload.title.strip(), prompt=payload.prompt, system_prompt=payload.system_prompt, mode=payload.mode, created_at=timestamp, results=results)


@app.get("/api/evaluations", response_model=list[Evaluation], tags=["evaluations"])
def list_evaluations() -> list[Evaluation]:
    with db_connection() as connection:
        rows = connection.execute("SELECT * FROM evaluations ORDER BY created_at DESC LIMIT 50").fetchall()
        result_rows = connection.execute("SELECT * FROM evaluation_results").fetchall()
    results: dict[str, list[EvaluationResult]] = {}
    for row in result_rows:
        result = row_to_evaluation_result(row)
        results.setdefault(result.evaluation_id, []).append(result)
    return [Evaluation(id=row["id"], title=row["title"], input=row["input"], output=row["output"], passed=bool(row["passed"]), created_at=row["created_at"], results=results.get(row["id"], [])) for row in rows]


@app.post("/api/evaluations", response_model=Evaluation, status_code=201, tags=["evaluations"])
def create_evaluation(payload: EvaluationCreate) -> Evaluation:
    evaluation_id = str(uuid4())
    results: list[EvaluationResult] = []
    for assertion in payload.assertions:
        passed, detail = evaluate_assertion(payload.output, assertion)
        results.append(EvaluationResult(id=str(uuid4()), evaluation_id=evaluation_id, assertion_type=assertion.type, expected=assertion.value, passed=passed, detail=detail))
    passed = all(result.passed for result in results)
    timestamp = now_string()
    with db_connection() as connection:
        connection.execute("INSERT INTO evaluations (id, title, input, output, passed, created_at) VALUES (?, ?, ?, ?, ?, ?)", (evaluation_id, payload.title.strip(), payload.input, payload.output, int(passed), timestamp))
        for result in results:
            connection.execute("INSERT INTO evaluation_results (id, evaluation_id, assertion_type, expected, passed, detail) VALUES (?, ?, ?, ?, ?, ?)", (result.id, result.evaluation_id, result.assertion_type, result.expected, int(result.passed), result.detail))
    return Evaluation(id=evaluation_id, title=payload.title.strip(), input=payload.input, output=payload.output, passed=passed, created_at=timestamp, results=results)


@app.get("/api/exports/conversations/{conversation_id}", tags=["exports"])
def export_conversation(conversation_id: str, format: Literal["json", "markdown", "csv", "html"] = "json") -> Response:
    conversation = get_conversation_record(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    with db_connection() as connection:
        run_rows = connection.execute("SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at", (conversation_id,)).fetchall()
    runs = [row_to_run(row) for row in run_rows]
    filename_base = "promptdeck-" + "".join(character if character.isalnum() else "-" for character in conversation.title.lower()).strip("-")[:48]
    if format == "json":
        content = json.dumps({"conversation": conversation.model_dump(mode="json"), "runs": [run.model_dump(mode="json") for run in runs]}, indent=2)
        media_type, extension = "application/json", "json"
    elif format == "markdown":
        blocks = [f"# {conversation.title}", f"_Exported {now().strftime('%Y-%m-%d %H:%M UTC')}_"]
        blocks.extend(f"\n## {message.role.title()}{f' · {message.model}' if message.model else ''}\n\n{message.content}" for message in conversation.messages)
        if runs:
            blocks.append("\n## Run telemetry\n\n| Provider | Model | Latency | Tokens | Cost |\n| --- | --- | ---: | ---: | ---: |")
            blocks.extend(f"| {run.provider} | {run.model} | {run.latency_ms} ms | {run.prompt_tokens + run.completion_tokens} | {run.cost_usd if run.cost_usd is not None else '—'} |" for run in runs)
        content, media_type, extension = "\n".join(blocks), "text/markdown", "md"
    elif format == "csv":
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(["record_type", "role", "model", "content", "created_at", "provider", "latency_ms", "tokens", "cost_usd"])
        writer.writerows(["message", message.role, message.model or "", message.content, message.created_at.isoformat(), "", "", "", ""] for message in conversation.messages)
        writer.writerows(["run", "", run.model, "", run.created_at.isoformat(), run.provider, run.latency_ms, run.prompt_tokens + run.completion_tokens, run.cost_usd if run.cost_usd is not None else ""] for run in runs)
        content, media_type, extension = stream.getvalue(), "text/csv", "csv"
    else:
        messages_html = "".join(f"<article><h2>{html.escape(message.role.title())}{f' · {html.escape(message.model)}' if message.model else ''}</h2><pre>{html.escape(message.content)}</pre></article>" for message in conversation.messages)
        content = f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(conversation.title)}</title><style>body{{font-family:system-ui;max-width:900px;margin:40px auto;padding:0 20px}}article{{border:1px solid #ddd;padding:16px;margin:12px 0}}pre{{white-space:pre-wrap;font:inherit}}</style></head><body><h1>{html.escape(conversation.title)}</h1>{messages_html}</body></html>"
        media_type, extension = "text/html", "html"
    return Response(content=content, media_type=f"{media_type}; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename_base or "conversation"}.{extension}"'})
