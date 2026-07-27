"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import {
  Activity,
  Atom,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  Command,
  Copy,
  Cpu,
  Database,
  FileText,
  History,
  PanelLeft,
  Plus,
  Radio,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  TerminalSquare,
  UserRound,
  Variable,
  Waves,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type RunMode = "demo" | "live"

type Provider = {
  id: string
  name: string
  model: string
  live_model: string
  color: string
  configured: boolean
  status: "ready" | "not_configured"
  required_env: string | null
}

type Message = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  model?: string | null
  created_at?: string
  status?: "streaming" | "complete" | "error"
}

type Conversation = {
  id: string
  title: string
  created_at: string
  updated_at: string
  messages: Message[]
}

type RunMetric = {
  id: string
  conversation_id: string
  provider: string
  model: string
  mode: RunMode
  status: "complete" | "error"
  latency_ms: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number | null
  token_source: "estimated" | "provider"
  created_at: string
}

type MetricsSummary = {
  total_runs: number
  completed_runs: number
  total_tokens: number
  average_latency_ms: number
  total_cost_usd: number | null
}

const emptySummary: MetricsSummary = {
  total_runs: 0,
  completed_runs: 0,
  total_tokens: 0,
  average_latency_ms: 0,
  total_cost_usd: null,
}

const navigation = [
  { label: "Inference lab", icon: Atom },
  { label: "Run history", icon: History },
  { label: "Provider mesh", icon: Radio },
]

function formatTokens(tokens: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(tokens)
}

function formatCost(cost: number | null) {
  return cost === null ? "—" : `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`
}

function formatLatency(milliseconds: number) {
  return milliseconds ? `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s` : "—"
}

function apiError(message: unknown) {
  return message instanceof Error ? message.message : "The control plane could not complete this request."
}

export default function Page() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [summary, setSummary] = useState<MetricsSummary>(emptySummary)
  const [selectedProviderId, setSelectedProviderId] = useState("openai")
  const [mode, setMode] = useState<RunMode>("demo")
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationName, setConversationName] = useState("Untitled signal")
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState("Design a safe rollout strategy for a Python API on Kubernetes.")
  const [systemPrompt, setSystemPrompt] = useState("You are a senior platform engineer. Be direct, concrete, and include trade-offs.")
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [lastRun, setLastRun] = useState<RunMetric | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [activeNav, setActiveNav] = useState("Inference lab")
  const [notice, setNotice] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const provider = useMemo(
    () => providers.find((item) => item.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  )

  async function refreshControlPlane() {
    const [providerResult, conversationResult, metricResult] = await Promise.allSettled([
      fetch(`${API_URL}/api/providers`).then((response) => response.json() as Promise<Provider[]>),
      fetch(`${API_URL}/api/conversations`).then((response) => response.json() as Promise<Conversation[]>),
      fetch(`${API_URL}/api/metrics/summary`).then((response) => response.json() as Promise<MetricsSummary>),
    ])
    if (providerResult.status === "fulfilled") {
      setProviders(providerResult.value)
      if (!providerResult.value.some((item) => item.id === selectedProviderId)) {
        setSelectedProviderId(providerResult.value[0]?.id ?? "openai")
      }
    }
    if (conversationResult.status === "fulfilled") setConversations(conversationResult.value)
    if (metricResult.status === "fulfilled") setSummary(metricResult.value)
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshControlPlane()
    }, 0)
    return () => window.clearTimeout(initialLoad)
  // The control-plane state is loaded once; subsequent runs call this function explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startNewRun() {
    setConversationId(null)
    setConversationName("Untitled signal")
    setMessages([])
    setLastRun(null)
    setPrompt("")
    setNotice(null)
  }

  async function loadConversation(id: string) {
    try {
      const response = await fetch(`${API_URL}/api/conversations/${id}`)
      if (!response.ok) throw new Error("Unable to load this run history.")
      const conversation = (await response.json()) as Conversation
      setConversationId(conversation.id)
      setConversationName(conversation.title)
      setMessages(conversation.messages.filter((message) => message.role !== "system"))
      setLastRun(null)
      setNotice(null)
    } catch (error) {
      setNotice(apiError(error))
    }
  }

  async function copyMessage(message: Message) {
    await navigator.clipboard?.writeText(message.content)
    setCopiedId(message.id)
    window.setTimeout(() => setCopiedId(null), 1400)
  }

  function setRunMode(nextMode: RunMode) {
    if (nextMode === "live" && !provider?.configured) {
      setNotice(`${provider?.name ?? "This provider"} is not configured. Set ${provider?.required_env ?? "its required environment value"} on the API, then restart it.`)
      return
    }
    setNotice(null)
    setMode(nextMode)
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = prompt.trim()
    if (!input || !provider || isStreaming) return

    const userMessage: Message = { id: `user-${Date.now()}`, role: "user", content: input, status: "complete" }
    const assistantId = `assistant-${Date.now()}`
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "", model: provider.model, status: "streaming" }])
    setPrompt("")
    setNotice(null)
    setIsStreaming(true)

    try {
      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          model: provider.model,
          mode,
          prompt: input,
          system_prompt: systemPrompt,
          temperature,
          max_tokens: maxTokens,
          conversation_id: conversationId,
        }),
      })
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? "The API did not return a response stream.")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let answer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""
        for (const block of events) {
          const data = block.split("\n").find((line) => line.startsWith("data: "))
          if (!data) continue
          const payload = JSON.parse(data.slice(6)) as {
            type: "token" | "complete" | "error"
            content?: string
            message?: string
            conversation_id?: string
            title?: string
            metrics?: RunMetric
          }
          if (payload.type === "token") {
            answer += payload.content ?? ""
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: answer } : message))
          }
          if (payload.type === "complete") {
            setConversationId(payload.conversation_id ?? null)
            setConversationName(payload.title ?? "Untitled signal")
            if (payload.metrics) setLastRun(payload.metrics)
          }
          if (payload.type === "error") throw new Error(payload.message ?? "Provider execution failed.")
        }
      }
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, status: "complete" } : message))
      await refreshControlPlane()
    } catch (error) {
      const message = apiError(error)
      setNotice(message)
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: message, status: "error" } : item))
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <main className="control-room min-h-svh overflow-hidden bg-[#06080d] text-slate-100">
      <div className="control-grid pointer-events-none fixed inset-0 opacity-40" />
      <div className="relative grid min-h-svh lg:grid-cols-[258px_minmax(0,1fr)_336px]">
        <aside className="hidden border-r border-white/8 bg-[#080b12]/90 px-4 py-5 backdrop-blur-xl lg:flex lg:flex-col">
          <div className="mb-8 flex items-center gap-3 px-2">
            <div className="logo-sigil grid size-9 place-items-center rounded-xl text-xs font-black tracking-tighter text-[#061017]">PD</div>
            <div><p className="text-sm font-bold tracking-[-0.03em] text-white">PromptDeck</p><p className="text-[9px] font-semibold tracking-[0.21em] text-cyan-300/60 uppercase">Control plane</p></div>
          </div>
          <Button onPress={startNewRun} className="mb-6 h-10 w-full justify-start rounded-xl border border-cyan-300/20 bg-cyan-300 px-3 text-xs font-bold text-[#061017] shadow-[0_0_28px_rgba(103,232,249,0.14)] hover:bg-cyan-200"><Plus className="size-4" /> Initialize run <Command className="ml-auto size-3 text-[#08232a]/60" /></Button>
          <div className="mb-2 px-2 text-[9px] font-bold tracking-[0.18em] text-slate-600 uppercase">Navigation</div>
          <nav className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon
              const isActive = activeNav === item.label
              return <button key={item.label} onClick={() => setActiveNav(item.label)} className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[12px] transition ${isActive ? "bg-white/8 text-cyan-200 shadow-[inset_2px_0_0_#67e8f9]" : "text-slate-500 hover:bg-white/5 hover:text-slate-200"}`}><Icon className="size-3.5" />{item.label}{isActive && <span className="ml-auto size-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_#67e8f9]" />}</button>
            })}
          </nav>
          <div className="mt-8 flex items-center justify-between px-2"><span className="text-[9px] font-bold tracking-[0.18em] text-slate-600 uppercase">Run archive</span><span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">{conversations.length}</span></div>
          <div className="mt-2 space-y-1 overflow-y-auto pr-1">
            {conversations.length ? conversations.map((conversation) => <button key={conversation.id} onClick={() => void loadConversation(conversation.id)} className={`group w-full rounded-lg border px-3 py-2.5 text-left transition ${conversation.id === conversationId ? "border-cyan-300/20 bg-cyan-300/8" : "border-transparent hover:border-white/7 hover:bg-white/4"}`}><div className="flex items-center gap-2"><FileText className="size-3 shrink-0 text-cyan-300/60" /><p className="truncate text-[11px] font-medium text-slate-300">{conversation.title}</p></div><p className="mt-1 pl-5 text-[9px] text-slate-600">{new Date(conversation.updated_at).toLocaleDateString()}</p></button>) : <div className="rounded-lg border border-dashed border-white/10 p-3 text-[10px] leading-4 text-slate-600">No persisted runs yet. Your first completed run will appear here.</div>}
          </div>
          <div className="mt-auto rounded-xl border border-white/8 bg-gradient-to-br from-white/[0.06] to-transparent p-3"><div className="mb-3 flex items-center gap-2"><Database className="size-3.5 text-violet-300" /><span className="text-[10px] font-semibold text-slate-300">Local memory core</span><span className="ml-auto size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" /></div><p className="text-[9px] leading-4 text-slate-500">Conversations and run telemetry persist in your local SQLite database.</p></div>
        </aside>

        <section className="flex min-w-0 flex-col border-r border-white/8">
          <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/8 bg-[#0a0d15]/80 px-4 backdrop-blur-xl sm:px-7">
            <div className="flex min-w-0 items-center gap-3"><button className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-400 lg:hidden" aria-label="Open navigation"><PanelLeft className="size-4" /></button><div className="min-w-0"><div className="flex items-center gap-2"><span className="signal-dot" /><p className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-100">{conversationName}</p></div><p className="mt-1 font-mono text-[9px] tracking-[0.12em] text-slate-600 uppercase">{conversationId ? `node ${conversationId.slice(0, 8)}` : "uncommitted node"}</p></div></div>
            <div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[9px] text-slate-500 sm:flex"><Waves className="size-3 text-cyan-300" /> SSE channel</span><Button onPress={startNewRun} variant="outline" size="sm" className="rounded-lg border-white/10 bg-white/[0.03] text-xs text-slate-300 hover:bg-white/10 hover:text-white"><RotateCcw className="size-3.5" /> Reset</Button></div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-white/8 bg-[#080b12]/60 px-4 py-3 sm:px-7"><div className="mx-auto flex max-w-4xl items-center justify-between"><div className="flex items-center gap-2"><span className="font-mono text-[9px] tracking-[0.14em] text-cyan-300/70 uppercase">{mode} channel</span><ChevronRight className="size-3 text-slate-700" /><span className="text-[10px] text-slate-500">{provider ? `${provider.name} / ${provider.model}` : "gateway offline"}</span></div><div className="flex items-center gap-3"><span className="hidden text-[10px] text-slate-600 sm:inline">{summary.completed_runs}/{summary.total_runs} successful runs</span><span className="font-mono text-[10px] text-violet-300/80">{formatTokens(summary.total_tokens)} TOKENS</span></div></div></div>
            {notice && <div className="mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-4xl items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-[11px] leading-5 text-amber-100"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" /><span>{notice}</span><button onClick={() => setNotice(null)} className="ml-auto text-amber-200/70">×</button></div>}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8">
              <div className="mx-auto max-w-4xl space-y-7">
                {!messages.length && <section className="relative overflow-hidden rounded-2xl border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(34,211,238,.08),rgba(139,92,246,.08)_52%,transparent)] p-6 sm:p-8"><div className="absolute -right-8 -top-12 size-44 rounded-full bg-cyan-300/10 blur-3xl" /><div className="relative"><div className="mb-5 flex items-center gap-2"><div className="grid size-8 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10"><Sparkles className="size-4 text-cyan-200" /></div><span className="font-mono text-[10px] font-bold tracking-[0.16em] text-cyan-200 uppercase">Signal workspace ready</span></div><h1 className="max-w-xl text-2xl font-semibold tracking-[-0.05em] text-white sm:text-3xl">Turn prompts into<br /><span className="text-cyan-200">observable runs.</span></h1><p className="mt-4 max-w-lg text-[12px] leading-6 text-slate-400">Every control in the rack affects the request. Demo mode is deterministic; Live mode sends your prompt to the provider you configured on the API server.</p><div className="mt-6 flex flex-wrap gap-2">{["system instruction", "temperature", "token cap", "stream telemetry"].map((item) => <span key={item} className="rounded-full border border-white/10 bg-black/15 px-2.5 py-1 font-mono text-[9px] text-slate-400">{item}</span>)}</div></div></section>}
                {messages.map((message) => <article key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}>
                  {message.role === "assistant" && <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Bot className="size-3.5" /></div>}
                  <div className={message.role === "user" ? "max-w-[82%]" : "min-w-0 max-w-3xl flex-1"}><div className="mb-1.5 flex items-center gap-2"><span className="font-mono text-[9px] font-bold tracking-[0.12em] text-slate-500 uppercase">{message.role === "user" ? "operator" : message.model ?? "gateway"}</span>{message.role === "assistant" && <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${message.status === "error" ? "bg-rose-400/10 text-rose-300" : "bg-cyan-300/10 text-cyan-300"}`}>{message.status === "error" ? "fault" : mode}</span>}</div><div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[12px] leading-6 ${message.role === "user" ? "rounded-tr-sm border border-violet-300/15 bg-violet-300/10 text-violet-100" : message.status === "error" ? "border border-rose-400/15 bg-rose-400/5 text-rose-100" : "border border-white/7 bg-white/[0.035] text-slate-300"}`}>{message.content || <span className="flex items-center gap-1 py-1"><i className="size-1.5 animate-pulse rounded-full bg-cyan-300" /><i className="size-1.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:150ms]" /><i className="size-1.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:300ms]" /></span>}</div>{message.role === "assistant" && message.content && message.status !== "streaming" && <div className="mt-2 flex gap-1"><button onClick={() => void copyMessage(message)} className="grid size-6 place-items-center rounded-md text-slate-600 hover:bg-white/7 hover:text-cyan-200" aria-label="Copy response">{copiedId === message.id ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}</button><button onClick={() => setPrompt(message.content)} className="grid size-6 place-items-center rounded-md text-slate-600 hover:bg-white/7 hover:text-cyan-200" aria-label="Use response as prompt"><RotateCcw className="size-3.5" /></button></div>}</div>
                  {message.role === "user" && <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg border border-violet-300/20 bg-violet-300/10 text-violet-200"><UserRound className="size-3.5" /></div>}
                </article>)}
              </div>
            </div>
            <form onSubmit={submitPrompt} className="border-t border-white/8 bg-[#090c14]/90 px-4 py-4 backdrop-blur-xl sm:px-8"><div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-[#0c111c] p-1 shadow-[0_18px_60px_rgba(0,0,0,.3)] focus-within:border-cyan-300/30"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Transmit a prompt to the inference channel…" className="h-20 w-full resize-none bg-transparent px-3 pt-3 text-[13px] leading-6 text-slate-200 outline-none placeholder:text-slate-600" /><div className="flex items-center justify-between border-t border-white/7 px-2 pt-2"><div className="flex items-center gap-1"><button type="button" className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-white/6 hover:text-cyan-200" aria-label="Prompt variables"><Variable className="size-3.5" /></button><span className="hidden font-mono text-[9px] text-slate-600 sm:inline">SHIFT + ENTER · NEWLINE</span></div><Button type="submit" isDisabled={!prompt.trim() || isStreaming || !provider} size="sm" className="h-8 rounded-lg bg-cyan-300 px-3 text-xs font-bold text-[#061017] hover:bg-cyan-200">{isStreaming ? <><Activity className="size-3.5 animate-spin" /> Streaming</> : <><SendHorizontal className="size-3.5" /> Execute</>}</Button></div></div></form>
          </div>
        </section>

        <aside className="order-first border-b border-white/8 bg-[#090c14]/95 backdrop-blur-xl lg:order-none lg:border-b-0">
          <div className="flex h-[72px] items-center justify-between border-b border-white/8 px-5"><div className="flex items-center gap-2"><Cpu className="size-4 text-cyan-300" /><div><p className="text-xs font-semibold text-white">Inference rack</p><p className="font-mono text-[8px] tracking-[0.14em] text-slate-600 uppercase">request controls</p></div></div><button onClick={() => setIsAdvancedOpen((value) => !value)} className="rounded-md border border-white/8 px-2 py-1 font-mono text-[9px] text-slate-400 hover:border-cyan-300/25 hover:text-cyan-200">{isAdvancedOpen ? "basic" : "inspect"}</button></div>
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:block lg:space-y-5 lg:p-5">
            <section className="sm:col-span-2"><div className="mb-2 flex items-center justify-between"><label className="rack-label">Execution mode</label><span className="font-mono text-[9px] text-slate-600">server controlled</span></div><div className="grid grid-cols-2 rounded-xl border border-white/9 bg-black/15 p-1"><button onClick={() => setRunMode("demo")} className={`rounded-lg py-2 text-[10px] font-bold transition ${mode === "demo" ? "bg-white/10 text-cyan-200" : "text-slate-600 hover:text-slate-300"}`}>DEMO</button><button onClick={() => setRunMode("live")} className={`rounded-lg py-2 text-[10px] font-bold transition ${mode === "live" ? "bg-emerald-400/15 text-emerald-200" : "text-slate-600 hover:text-slate-300"}`}>LIVE</button></div><p className="mt-2 text-[9px] leading-4 text-slate-600">Demo is local and deterministic. Live only unlocks when the selected provider is configured.</p></section>
            <section><label className="rack-label">Provider route</label><select value={selectedProviderId} onChange={(event) => { setSelectedProviderId(event.target.value); setMode("demo"); setNotice(null) }} className="mt-2 h-10 w-full appearance-none rounded-xl border border-white/10 bg-[#0c111c] px-3 text-[11px] text-slate-200 outline-none focus:border-cyan-300/40">{providers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.configured ? "live ready" : "demo only"}</option>)}</select>{provider && <div className="mt-2 flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${provider.configured ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-600"}`} /><span className="text-[9px] text-slate-500">{provider.configured ? "Live credentials detected" : `Needs ${provider.required_env}`}</span></div>}</section>
            <section><label className="rack-label">Resolved model</label><div className="mt-2 flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3"><Braces className="size-3.5 text-violet-300" /><span className="truncate font-mono text-[10px] text-slate-300">{mode === "live" ? provider?.live_model : provider?.model ?? "awaiting route"}</span></div></section>
            <section><div className="flex items-center justify-between"><label className="rack-label">Temperature</label><span className="font-mono text-[10px] text-cyan-200">{temperature.toFixed(1)}</span></div><input aria-label="Temperature" type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} className="control-range mt-3 w-full" /><div className="mt-1 flex justify-between font-mono text-[8px] text-slate-700"><span>PRECISE</span><span>EXPANSIVE</span></div></section>
            <section><div className="flex items-center justify-between"><label className="rack-label">Output ceiling</label><span className="font-mono text-[10px] text-cyan-200">{maxTokens}</span></div><input aria-label="Maximum output tokens" type="range" min="256" max="4096" step="256" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} className="control-range mt-3 w-full" /><div className="mt-1 flex justify-between font-mono text-[8px] text-slate-700"><span>256</span><span>4096</span></div></section>
            <section className="sm:col-span-2"><label className="rack-label">System instruction</label><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} className="mt-2 h-[84px] w-full resize-none rounded-xl border border-white/10 bg-black/15 p-3 text-[11px] leading-5 text-slate-300 outline-none focus:border-cyan-300/40" /></section>
            {isAdvancedOpen && <section className="sm:col-span-2 rounded-xl border border-dashed border-cyan-300/20 bg-cyan-300/[0.035] p-3"><div className="mb-2 flex items-center gap-2"><Code2 className="size-3.5 text-cyan-300" /><span className="rack-label text-cyan-200">Wire protocol</span></div><code className="block break-all font-mono text-[9px] leading-5 text-slate-500">POST /api/chat/stream · mode={mode} · temp={temperature.toFixed(1)} · max_tokens={maxTokens}</code><p className="mt-2 text-[9px] leading-4 text-slate-600">Provider keys are never exposed to the browser. The API reads them from its own environment.</p></section>}
          </div>
          <div className="border-t border-white/8 px-5 py-4"><div className="mb-3 flex items-center justify-between"><span className="rack-label">Observed telemetry</span><span className="font-mono text-[9px] text-slate-600">{lastRun ? lastRun.status : "idle"}</span></div><div className="grid grid-cols-3 divide-x divide-white/8 rounded-xl border border-white/8 bg-black/15 py-2.5"><div className="px-2 text-center"><p className="font-mono text-[12px] text-slate-200">{lastRun ? formatTokens(lastRun.prompt_tokens + lastRun.completion_tokens) : "—"}</p><p className="mt-1 text-[8px] tracking-wide text-slate-600 uppercase">tokens</p></div><div className="px-2 text-center"><p className="font-mono text-[12px] text-slate-200">{lastRun ? formatLatency(lastRun.latency_ms) : "—"}</p><p className="mt-1 text-[8px] tracking-wide text-slate-600 uppercase">latency</p></div><div className="px-2 text-center"><p className="font-mono text-[12px] text-slate-200">{lastRun ? formatCost(lastRun.cost_usd) : "—"}</p><p className="mt-1 text-[8px] tracking-wide text-slate-600 uppercase">cost</p></div></div>{lastRun && <p className="mt-2 text-center font-mono text-[8px] text-slate-600">{lastRun.token_source} tokens · {lastRun.mode} run</p>}</div>
          <div className="flex items-center gap-2 border-t border-white/8 px-5 py-3"><TerminalSquare className="size-3.5 text-cyan-300/70" /><span className="font-mono text-[9px] tracking-[0.08em] text-slate-500 uppercase">Local gateway online</span><span className="ml-auto size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" /></div>
        </aside>
      </div>
    </main>
  )
}
