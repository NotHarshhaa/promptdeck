# 🚀 PromptDeck

<p align="center">
  <img src="./assets/logo.png" alt="PromptDeck" width="180"/>
</p>

<h3 align="center">
The Open Source Platform for Building, Testing, Comparing & Evaluating LLM Prompts
</h3>

<p align="center">
Build once • Compare any model • Evaluate responses • Track costs • Experiment faster
</p>

<p align="center">
<img src="https://img.shields.io/github/license/NotHarshhaa/promptdeck?style=for-the-badge"/>
<img src="https://img.shields.io/github/stars/NotHarshhaa/promptdeck?style=for-the-badge"/>
<img src="https://img.shields.io/github/issues/NotHarshhaa/promptdeck?style=for-the-badge"/>
<img src="https://img.shields.io/github/last-commit/NotHarshhaa/promptdeck?style=for-the-badge"/>
<img src="https://img.shields.io/badge/Python-3.11+-blue?style=for-the-badge"/>
<img src="https://img.shields.io/badge/Next.js-Frontend-black?style=for-the-badge"/>
</p>

---

## ✨ Overview

**PromptDeck** is an open-source AI engineering platform that lets developers interact with multiple LLM providers through a single interface.

Instead of switching between ChatGPT, Claude, Gemini, Ollama, and a dozen other tools, PromptDeck brings prompt testing, model comparison, evaluation, and cost tracking into one workspace.

> **Status:** Early-stage / actively developed. See [Roadmap](#️-roadmap) for what's shipped vs. planned — the feature list below is marked accordingly.

---

## 🎯 Why PromptDeck?

AI developers currently stitch together multiple disconnected tools:

- ChatGPT / provider consoles for chatting
- OpenRouter for unified APIs
- Promptfoo for evaluations
- LangSmith for tracing
- Postman for API testing
- Spreadsheets for cost tracking
- Notes apps for prompt storage

PromptDeck consolidates these into one platform instead of one more tab.

---

## 🚀 Quickstart

### Prerequisites
- Python 3.11+
- Node.js 18+
- Docker & Docker Compose (recommended)
- At least one provider API key (OpenAI, Gemini, Claude, etc.) or a local Ollama install

### Run with Docker (recommended)

```bash
git clone https://github.com/NotHarshhaa/promptdeck.git
cd promptdeck
cp .env.example .env   # add your API keys
docker compose up --build
```

App: `http://localhost:3000` · API: `http://localhost:8000`

### Run manually

```bash
# Backend
cd apps/api
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (new terminal)
cd apps/web
npm install
npm run dev
```

### Configure

```env
# .env
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
DATABASE_URL=
REDIS_URL=
```

---

## ✨ Features

**Shipped (v0.1–v0.2):**
- 🤖 Multi-provider chat (OpenAI, Gemini, Claude, Groq, Ollama, and any OpenAI-compatible API via LiteLLM)
- ⚡ Prompt playground — editor, markdown, syntax highlighting, variables, temperature/token controls
- 🔥 Streaming responses
- 💬 Conversation history — search, filter, tags, favorites
- 🔐 API key management
- 🌙 Dark/light mode, responsive UI

**In progress (v0.2–v0.3):**
- 🔀 Side-by-side model comparison (quality, latency, tokens, cost, time-to-first-token)
- 📚 Reusable prompt library (DevOps, Kubernetes, AWS, Terraform, SQL, and more categories)
- 💰 Cost tracking per provider/model/project
- 📝 Prompt versioning — history, diff, rollback, tags ("git for prompts")

**Planned (v0.4+):**
- 📊 Analytics dashboard (usage, success/error rate, response time)
- 📈 Automated evaluations — hallucination detection, groundedness, toxicity, JSON validation, faithfulness
- 📤 Export to Markdown/JSON/HTML/PDF/CSV
- 🔌 LangGraph workflows, MCP support, plugin system

See the full breakdown in [Roadmap](#️-roadmap).

---

## 🏗️ Architecture

```
                        +----------------------+
                        |       Frontend       |
                        |   Next.js + React    |
                        +----------+-----------+
                                   │
                      REST / WebSocket API
                                   │
                    +--------------+--------------+
                    |         FastAPI API         |
                    +--------------+--------------+
                                   │
             +---------------------+----------------------+
             │                                            │
      Authentication                              AI Gateway
             │                                            │
      PostgreSQL / Redis                    LiteLLM / LangChain
             │                                            │
             +---------------------+----------------------+
                                   │
         +-----------+-----------+-----------+-----------+
         │           │           │           │           │
      OpenAI      Gemini      Claude      Ollama    + more via
                                                       LiteLLM
```

---

## 🛠 Tech Stack

| Layer | Tools |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, Monaco Editor, TanStack Query, Zustand |
| Backend | FastAPI, Python 3.11+, SQLAlchemy, Pydantic v2, PostgreSQL, Redis |
| AI | LiteLLM, LangChain, LangGraph, Instructor, OpenAI SDK |
| Observability *(planned)* | OpenTelemetry, Langfuse, Prometheus, Grafana, Loki |
| Deployment | Docker, Docker Compose, Kubernetes, GitHub Actions |

---

## 📂 Project Structure

```
promptdeck/
├── apps/
│   ├── api/          # FastAPI backend
│   ├── web/           # Next.js frontend
│   └── docs/
├── packages/
│   ├── sdk/
│   ├── ui/
│   ├── providers/     # Provider adapters
│   ├── prompts/
│   ├── evaluation/
│   └── shared/
├── docker/
├── kubernetes/
├── scripts/
├── examples/
└── .github/
```

---

## 🗺️ Roadmap

| Version | Focus |
|---|---|
| **v0.1** ✅ | Multi-provider chat, streaming, API keys, conversation history |
| **v0.2** 🔄 | Model comparison, prompt library & templates, cost tracking |
| **v0.3** ⬜ | Prompt versioning, export, analytics dashboard |
| **v0.4** ⬜ | AI evaluations, batch testing, benchmarks, reports |
| **v0.5** ⬜ | LangGraph workflows, MCP support, plugins, AI gateway |
| **v1.0** ⬜ | Teams, workspaces, RBAC, audit logs, usage limits |

---

## 🤝 Contributing

Contributions are welcome from developers of all experience levels — bug fixes, new provider integrations, docs, UI improvements, tests, and performance work.

`CONTRIBUTING.md` is on the way; until then, feel free to open an issue or PR directly.

---

## 📜 License

Licensed under the [MIT License](LICENSE).

---

## ❤️ Built For

PromptDeck is built for AI/LLM engineers, platform and MLOps engineers, DevOps engineers, researchers, and anyone building with generative AI who's tired of juggling five different tools to test a prompt.

---

<p align="center">
<strong>⭐ Star the repo if you believe open-source AI engineering tools should be accessible to everyone.</strong>
</p>
