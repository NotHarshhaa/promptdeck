"use client"

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react"
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
  FileText,
  History,
  PanelLeft,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  TerminalSquare,
  UserRound,
  Variable,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type RunMode = "demo" | "live"
type NavigationItem = "Playground" | "Run history" | "Providers"

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

type PromptVariable = {
  id: string
  name: string
  value: string
}

const emptySummary: MetricsSummary = {
  total_runs: 0,
  completed_runs: 0,
  total_tokens: 0,
  average_latency_ms: 0,
  total_cost_usd: null,
}

const navigation: { label: NavigationItem; icon: typeof Atom }[] = [
  { label: "Playground", icon: Atom },
  { label: "Run history", icon: History },
  { label: "Providers", icon: Radio },
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function apiError(message: unknown) {
  return message instanceof Error ? message.message : "The API could not complete this request."
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{children}</label>
}

type SidebarContentProps = {
  activeNav: NavigationItem
  conversationId: string | null
  conversations: Conversation[]
  conversationSearch: string
  onConversationSearchChange: (value: string) => void
  onNavigate: (destination: NavigationItem) => void
  onOpenConversation: (id: string) => void
  onStartNewRun: () => void
}

function SidebarContent({
  activeNav,
  conversationId,
  conversations,
  conversationSearch,
  onConversationSearchChange,
  onNavigate,
  onOpenConversation,
  onStartNewRun,
}: SidebarContentProps) {
  const visibleConversations = useMemo(() => {
    const search = conversationSearch.trim().toLowerCase()
    return search ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(search)) : conversations
  }, [conversationSearch, conversations])

  return (
    <>
      <Button onPress={onStartNewRun} size="sm" className="mb-4 w-full justify-start"><Plus /> New run <Command className="ml-auto size-3" /></Button>
      <nav className="space-y-1" aria-label="Workspace navigation">
        {navigation.map((item) => {
          const Icon = item.icon
          const isActive = activeNav === item.label
          return (
            <button
              key={item.label}
              onClick={() => onNavigate(item.label)}
              className={`flex h-8 w-full items-center gap-2 px-2 text-left text-xs transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-7 flex items-center justify-between">
        <p className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Recent runs</p>
        <Badge variant="outline">{conversations.length}</Badge>
      </div>
      <div className="mt-3">
        <Input value={conversationSearch} onChange={(event) => onConversationSearchChange(event.target.value)} placeholder="Filter history" aria-label="Filter run history" />
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {visibleConversations.length ? visibleConversations.map((conversation) => (
          <button
            key={conversation.id}
            onClick={() => onOpenConversation(conversation.id)}
            className={`w-full border px-2.5 py-2 text-left transition-colors ${conversation.id === conversationId ? "border-foreground bg-muted" : "border-transparent hover:border-border hover:bg-muted/50"}`}
          >
            <div className="flex items-center gap-2"><FileText className="size-3 shrink-0 text-muted-foreground" /><p className="truncate text-xs">{conversation.title}</p></div>
            <p className="mt-1 pl-5 text-[10px] text-muted-foreground">{formatDate(conversation.updated_at)}</p>
          </button>
        )) : <p className="border border-dashed p-3 text-xs leading-5 text-muted-foreground">{conversationSearch ? "No matching runs." : "Completed runs are saved here."}</p>}
      </div>
      <Card size="sm" className="mt-4 border">
        <CardContent className="flex items-start gap-2 text-[11px] text-muted-foreground"><TerminalSquare className="mt-0.5 size-3.5 shrink-0" />Conversations and metrics are stored by the local API.</CardContent>
      </Card>
    </>
  )
}

export default function Page() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [summary, setSummary] = useState<MetricsSummary>(emptySummary)
  const [selectedProviderId, setSelectedProviderId] = useState("openai")
  const [mode, setMode] = useState<RunMode>("demo")
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationName, setConversationName] = useState("Untitled run")
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState("Design a safe rollout strategy for a Python API on Kubernetes.")
  const [systemPrompt, setSystemPrompt] = useState("You are a senior platform engineer. Be direct, concrete, and include trade-offs.")
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [lastRun, setLastRun] = useState<RunMetric | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeNav, setActiveNav] = useState<NavigationItem>("Playground")
  const [notice, setNotice] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const [conversationSearch, setConversationSearch] = useState("")
  const [inspectorTab, setInspectorTab] = useState("settings")
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [isVariablePanelOpen, setIsVariablePanelOpen] = useState(false)
  const [variables, setVariables] = useState<PromptVariable[]>([])

  const provider = useMemo(
    () => providers.find((item) => item.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  )

  const visibleConversations = useMemo(() => {
    const search = conversationSearch.trim().toLowerCase()
    return search ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(search)) : conversations
  }, [conversationSearch, conversations])

  const currentViewTitle = activeNav === "Playground" ? conversationName : activeNav

  async function refreshControlPlane() {
    setIsRefreshing(true)
    try {
      const [providerResult, conversationResult, metricResult] = await Promise.allSettled([
        fetch(`${API_URL}/api/providers`).then(async (response) => {
          if (!response.ok) throw new Error("Unable to load provider status.")
          return response.json() as Promise<Provider[]>
        }),
        fetch(`${API_URL}/api/conversations`).then(async (response) => {
          if (!response.ok) throw new Error("Unable to load saved runs.")
          return response.json() as Promise<Conversation[]>
        }),
        fetch(`${API_URL}/api/metrics/summary`).then(async (response) => {
          if (!response.ok) throw new Error("Unable to load workspace metrics.")
          return response.json() as Promise<MetricsSummary>
        }),
      ])
      if (providerResult.status === "fulfilled") {
        setProviders(providerResult.value)
        if (!providerResult.value.some((item) => item.id === selectedProviderId)) {
          setSelectedProviderId(providerResult.value[0]?.id ?? "openai")
        }
      }
      if (conversationResult.status === "fulfilled") setConversations(conversationResult.value)
      if (metricResult.status === "fulfilled") setSummary(metricResult.value)
      if ([providerResult, conversationResult, metricResult].some((result) => result.status === "rejected")) {
        setNotice("Some workspace data could not be refreshed. Check that the local API is running.")
      }
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refreshControlPlane(), 0)
    return () => window.clearTimeout(initialLoad)
    // The control-plane state is loaded once; subsequent runs call this function explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startNewRun() {
    setConversationId(null)
    setConversationName("Untitled run")
    setMessages([])
    setLastRun(null)
    setPrompt("")
    setNotice(null)
  }

  function openNewRun() {
    startNewRun()
    setActiveNav("Playground")
    setIsNavigationOpen(false)
  }

  function navigate(destination: NavigationItem) {
    setActiveNav(destination)
    setIsNavigationOpen(false)
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

  async function openConversation(id: string) {
    await loadConversation(id)
    setActiveNav("Playground")
    setIsNavigationOpen(false)
  }

  async function copyText(value: string, key: string) {
    try {
      await navigator.clipboard?.writeText(value)
      setCopiedValue(key)
      window.setTimeout(() => setCopiedValue(null), 1400)
    } catch {
      setNotice("The browser could not access the clipboard.")
    }
  }

  async function copyMessage(message: Message) {
    await copyText(message.content, `message-${message.id}`)
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

  function selectProvider(providerId: string, nextMode: RunMode = "demo") {
    setSelectedProviderId(providerId)
    setMode(nextMode)
    setNotice(null)
    setActiveNav("Playground")
  }

  function addVariable() {
    setVariables((current) => [...current, { id: `variable-${Date.now()}-${current.length}`, name: "", value: "" }])
  }

  function updateVariable(id: string, field: "name" | "value", value: string) {
    setVariables((current) => current.map((variable) => variable.id === id ? { ...variable, [field]: value } : variable))
  }

  function interpolateTemplate(template: string) {
    return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (placeholder, name: string) => {
      const variable = variables.find((item) => item.name.trim() === name.trim())
      return variable?.value ?? placeholder
    })
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = interpolateTemplate(prompt).trim()
    const resolvedSystemPrompt = interpolateTemplate(systemPrompt)
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
          system_prompt: resolvedSystemPrompt,
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
            setConversationName(payload.title ?? "Untitled run")
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
    <main className="min-h-svh bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-7 place-items-center border bg-foreground text-xs font-bold text-background">P</div>
          <div>
            <p className="text-sm font-semibold tracking-tight">PromptDeck</p>
            <p className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Prompt workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:inline-flex">Local API</Badge>
          <TooltipTrigger><Button onPress={() => void refreshControlPlane()} variant="outline" size="icon-sm" isDisabled={isRefreshing} aria-label="Refresh workspace data"><RefreshCw className={isRefreshing ? "animate-spin" : ""} /></Button><Tooltip>Refresh provider, history, and metrics data</Tooltip></TooltipTrigger>
          <Button onPress={openNewRun} size="sm"><Plus /> New run <Command className="ml-1 size-3" /></Button>
        </div>
      </header>

      <div className="grid min-h-[calc(100svh-3.5rem)] lg:grid-cols-[236px_minmax(0,1fr)_320px]">
        <aside className="hidden border-r p-3 lg:flex lg:flex-col">
          <SidebarContent
            activeNav={activeNav}
            conversationId={conversationId}
            conversations={conversations}
            conversationSearch={conversationSearch}
            onConversationSearchChange={setConversationSearch}
            onNavigate={navigate}
            onOpenConversation={(id) => void openConversation(id)}
            onStartNewRun={openNewRun}
          />
        </aside>

        <section className="flex min-w-0 flex-col border-r">
          <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="outline" size="icon-sm" className="lg:hidden" onPress={() => setIsNavigationOpen(true)} aria-label="Open navigation"><PanelLeft /></Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="size-1.5 bg-foreground" /><p className="truncate text-sm font-medium">{currentViewTitle}</p></div>
                <p className="mt-0.5 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{activeNav === "Playground" ? conversationId ? `Run ${conversationId.slice(0, 8)}` : "Draft run" : "Workspace view"}</p>
              </div>
            </div>
            {activeNav === "Playground" && <Button onPress={startNewRun} variant="outline" size="sm"><RotateCcw /> Reset</Button>}
          </header>

          {notice && <div className="mx-4 mt-4 flex items-start gap-2 border bg-muted px-3 py-2 text-xs leading-5 sm:mx-6"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /><span className="flex-1">{notice}</span><button onClick={() => setNotice(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss notice"><X className="size-3.5" /></button></div>}

          {activeNav === "Playground" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/35 px-4 py-2 sm:px-6">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">{mode}</Badge><ChevronRight className="size-3" /><span>{provider ? `${provider.name} / ${provider.model}` : "Connecting to API"}</span></div>
                <span className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">{summary.completed_runs}/{summary.total_runs} completed · {formatTokens(summary.total_tokens)} tokens</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                <div className="mx-auto max-w-3xl space-y-5">
                  {!messages.length && (
                    <Card className="border">
                      <CardHeader className="border-b">
                        <div className="flex items-center justify-between gap-3"><CardTitle>Start a prompt run</CardTitle><Badge variant="outline">Ready</Badge></div>
                        <CardDescription>Choose a provider, adjust the request settings, then send a prompt. Live requests use only credentials configured on the server.</CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
                        {["System instruction", "Model settings", "Run telemetry"].map((item, index) => <div key={item} className="border-l pl-3"><p className="text-[10px] text-muted-foreground">0{index + 1}</p><p className="mt-1 text-xs font-medium">{item}</p></div>)}
                      </CardContent>
                    </Card>
                  )}

                  {messages.map((message) => (
                    <article key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}>
                      {message.role === "assistant" && <div className="mt-0.5 grid size-7 shrink-0 place-items-center border"><Bot className="size-3.5" /></div>}
                      <div className={message.role === "user" ? "max-w-[82%]" : "min-w-0 max-w-2xl flex-1"}>
                        <div className="mb-1.5 flex items-center gap-2 text-[10px] tracking-[0.1em] text-muted-foreground uppercase"><span>{message.role === "user" ? "You" : message.model ?? "Assistant"}</span>{message.role === "assistant" && <Badge variant="outline">{message.status === "error" ? "Issue" : mode}</Badge>}</div>
                        <div className={`whitespace-pre-wrap border px-3 py-2.5 text-xs leading-6 ${message.role === "user" ? "bg-muted" : "bg-card"}`}>
                          {message.content || <span className="inline-flex items-center gap-1 text-muted-foreground"><Activity className="size-3 animate-spin" /> Generating response</span>}
                        </div>
                        {message.role === "assistant" && message.content && message.status !== "streaming" && (
                          <div className="mt-1.5 flex gap-1">
                            <TooltipTrigger><Button onPress={() => void copyMessage(message)} variant="ghost" size="icon-xs" aria-label="Copy response">{copiedId === message.id ? <Check /> : <Copy />}</Button><Tooltip>{copiedId === message.id ? "Copied" : "Copy response"}</Tooltip></TooltipTrigger>
                            <TooltipTrigger><Button onPress={() => setPrompt(message.content)} variant="ghost" size="icon-xs" aria-label="Use response as prompt"><RotateCcw /></Button><Tooltip>Use as a new prompt</Tooltip></TooltipTrigger>
                          </div>
                        )}
                      </div>
                      {message.role === "user" && <div className="mt-0.5 grid size-7 shrink-0 place-items-center border bg-muted"><UserRound className="size-3.5" /></div>}
                    </article>
                  ))}
                </div>
              </div>

              <form onSubmit={submitPrompt} className="border-t bg-background p-4 sm:p-6">
                <div className="mx-auto max-w-3xl border bg-card p-2">
                  {isVariablePanelOpen && (
                    <div className="mb-2 border bg-muted/35 p-3">
                      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium">Prompt variables</p><p className="mt-0.5 text-[10px] text-muted-foreground">Use <code>{"{{name}}"}</code> in the prompt or system instruction.</p></div><Button type="button" onPress={() => setIsVariablePanelOpen(false)} variant="ghost" size="icon-xs" aria-label="Close variables"><X /></Button></div>
                      <div className="mt-3 space-y-2">
                        {variables.map((variable) => <div key={variable.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"><Input value={variable.name} onChange={(event) => updateVariable(variable.id, "name", event.target.value)} placeholder="name" aria-label="Variable name" /><Input value={variable.value} onChange={(event) => updateVariable(variable.id, "value", event.target.value)} placeholder="value" aria-label="Variable value" /><Button type="button" onPress={() => setVariables((current) => current.filter((item) => item.id !== variable.id))} variant="ghost" size="icon-sm" aria-label={`Remove ${variable.name || "variable"}`}><X /></Button></div>)}
                      </div>
                      <Button type="button" onPress={addVariable} variant="outline" size="sm" className="mt-3"><Plus /> Add variable</Button>
                    </div>
                  )}
                  <Textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}
                    placeholder="Ask the selected model anything…"
                    className="h-20 resize-none border-0 px-1 py-1 focus-visible:ring-0"
                  />
                  <Separator />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <TooltipTrigger><Button type="button" onPress={() => setIsVariablePanelOpen((open) => !open)} variant={isVariablePanelOpen ? "secondary" : "ghost"} size="icon-xs" aria-label="Manage prompt variables"><Variable /></Button><Tooltip>Insert and resolve prompt variables</Tooltip></TooltipTrigger>
                      <span className="hidden text-[10px] text-muted-foreground sm:inline">Shift + Enter for newline</span>
                    </div>
                    <Button type="submit" isDisabled={!prompt.trim() || isStreaming || !provider} size="sm">{isStreaming ? <><Activity className="animate-spin" /> Running</> : <><SendHorizontal /> Run prompt</>}</Button>
                  </div>
                </div>
              </form>
            </div>
          ) : activeNav === "Run history" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mx-auto max-w-4xl">
                <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-lg font-semibold tracking-tight">Run history</h1><p className="mt-1 text-xs text-muted-foreground">Open any persisted conversation or filter the local run archive.</p></div><Button onPress={() => void refreshControlPlane()} variant="outline" size="sm" isDisabled={isRefreshing}><RefreshCw className={isRefreshing ? "animate-spin" : ""} /> Refresh</Button></div>
                <div className="mt-6 grid gap-px border bg-border sm:grid-cols-3"><div className="bg-card p-4"><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Total runs</p><p className="mt-2 font-mono text-xl">{summary.total_runs}</p></div><div className="bg-card p-4"><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Completed</p><p className="mt-2 font-mono text-xl">{summary.completed_runs}</p></div><div className="bg-card p-4"><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Average latency</p><p className="mt-2 font-mono text-xl">{formatLatency(summary.average_latency_ms)}</p></div></div>
                <div className="mt-6"><Input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search saved runs" aria-label="Search saved runs" /></div>
                <div className="mt-4 space-y-2">
                  {visibleConversations.length ? visibleConversations.map((conversation) => <Card key={conversation.id} size="sm" className="border"><CardContent className="flex flex-wrap items-center gap-3"><FileText className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{conversation.title}</p><p className="mt-1 text-[10px] text-muted-foreground">Updated {formatDate(conversation.updated_at)}</p></div><Button onPress={() => void openConversation(conversation.id)} variant="outline" size="sm">Open run <ChevronRight /></Button></CardContent></Card>) : <Card className="border"><CardContent className="py-8 text-center text-xs text-muted-foreground">No saved runs match this filter.</CardContent></Card>}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mx-auto max-w-4xl"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-lg font-semibold tracking-tight">Providers</h1><p className="mt-1 text-xs text-muted-foreground">Choose a route for Demo mode or view the environment key needed for Live mode.</p></div><Button onPress={() => void refreshControlPlane()} variant="outline" size="sm" isDisabled={isRefreshing}><RefreshCw className={isRefreshing ? "animate-spin" : ""} /> Refresh status</Button></div>
                <div className="mt-6 grid gap-3 md:grid-cols-2">{providers.map((item) => <Card key={item.id} className={`border ${selectedProviderId === item.id ? "border-foreground" : ""}`}><CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><CardTitle>{item.name}</CardTitle><Badge variant={item.configured ? "default" : "outline"}>{item.configured ? "Live ready" : "Demo ready"}</Badge></div><CardDescription className="font-mono">{item.model}</CardDescription></CardHeader><CardContent className="space-y-3 pt-4"><div><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Live route</p><p className="mt-1 break-all font-mono text-xs">{item.live_model}</p></div><div><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Server configuration</p><p className="mt-1 text-xs text-muted-foreground">{item.configured ? "Configured on the API server." : `${item.required_env} is not configured.`}</p></div><div className="flex flex-wrap gap-2"><Button onPress={() => selectProvider(item.id)} size="sm">Use in playground <ChevronRight /></Button>{item.required_env && <Button onPress={() => void copyText(`${item.required_env}=`, `env-${item.id}`)} variant="outline" size="sm">{copiedValue === `env-${item.id}` ? <><Check /> Copied</> : <><Copy /> Copy env key</>}</Button>}</div></CardContent></Card>)}</div>
                {!providers.length && <Card className="mt-6 border"><CardContent className="py-8 text-center text-xs text-muted-foreground">No provider routes are available. Refresh after starting the local API.</CardContent></Card>}
              </div>
            </div>
          )}
        </section>

        <aside className="order-first border-b lg:order-none lg:border-b-0">
          <div className="flex h-14 items-center gap-2 border-b px-4"><Cpu className="size-4" /><div><p className="text-xs font-medium">Request inspector</p><p className="text-[10px] text-muted-foreground">Configure and review</p></div></div>
          <div className="p-4">
            <Tabs selectedKey={inspectorTab} onSelectionChange={(key) => setInspectorTab(String(key))}>
              <TabsList variant="line" className="w-full justify-start border-b">
                <TabsTrigger id="settings">Settings</TabsTrigger>
                <TabsTrigger id="telemetry">Telemetry</TabsTrigger>
              </TabsList>
              <TabsContent id="settings" className="pt-4">
                <div className="space-y-5">
                  <section>
                    <div className="mb-2 flex items-center justify-between"><FieldLabel>Execution mode</FieldLabel><span className="text-[10px] text-muted-foreground">Server controlled</span></div>
                    <div className="grid grid-cols-2 border p-1"><Button type="button" onPress={() => setRunMode("demo")} variant={mode === "demo" ? "default" : "ghost"} size="sm">Demo</Button><Button type="button" onPress={() => setRunMode("live")} variant={mode === "live" ? "default" : "ghost"} size="sm">Live</Button></div>
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Demo returns a deterministic response. Live is enabled only for configured providers.</p>
                  </section>
                  <section>
                    <FieldLabel>Provider</FieldLabel>
                    <select value={selectedProviderId} onChange={(event) => { setSelectedProviderId(event.target.value); setMode("demo"); setNotice(null) }} className="mt-2 h-8 w-full border bg-background px-2.5 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/50">
                      {providers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.configured ? "live ready" : "demo only"}</option>)}
                    </select>
                    <p className="mt-2 text-[11px] text-muted-foreground">{provider?.configured ? "Live credentials are available on the server." : provider ? `Requires ${provider.required_env} for live mode.` : "Loading provider routes."}</p>
                  </section>
                  <section><FieldLabel>Resolved model</FieldLabel><div className="mt-2 flex h-8 items-center gap-2 border px-2.5"><Braces className="size-3.5 text-muted-foreground" /><span className="truncate font-mono text-[11px]">{mode === "live" ? provider?.live_model : provider?.model ?? "Waiting for provider"}</span></div></section>
                  <section><div className="flex items-center justify-between"><FieldLabel>Temperature</FieldLabel><span className="font-mono text-xs">{temperature.toFixed(1)}</span></div><Slider aria-label="Temperature" minValue={0} maxValue={2} step={0.1} value={temperature} onChange={(value) => setTemperature(Number(value))} className="mt-3" /><div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Precise</span><span>Expansive</span></div></section>
                  <section><div className="flex items-center justify-between"><FieldLabel>Maximum tokens</FieldLabel><span className="font-mono text-xs">{maxTokens}</span></div><Slider aria-label="Maximum output tokens" minValue={256} maxValue={4096} step={256} value={maxTokens} onChange={(value) => setMaxTokens(Number(value))} className="mt-3" /><div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>256</span><span>4096</span></div></section>
                  <section><FieldLabel>System instruction</FieldLabel><Textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} className="mt-2 h-24 resize-none" /></section>
                  <Card size="sm" className="border"><CardHeader className="border-b"><CardTitle className="flex items-center gap-2"><Code2 className="size-3.5" />Request contract</CardTitle></CardHeader><CardContent className="font-mono text-[10px] leading-5 text-muted-foreground">POST /api/chat/stream<br />mode={mode} · temp={temperature.toFixed(1)} · max_tokens={maxTokens}</CardContent></Card>
                </div>
              </TabsContent>
              <TabsContent id="telemetry" className="pt-4">
                <Card className="border"><CardHeader className="border-b"><CardTitle>Latest run</CardTitle><CardDescription>Values reported after the stream finishes.</CardDescription></CardHeader><CardContent className="grid grid-cols-3 divide-x pt-4 text-center"><div><p className="font-mono text-sm">{lastRun ? formatTokens(lastRun.prompt_tokens + lastRun.completion_tokens) : "—"}</p><p className="mt-1 text-[10px] text-muted-foreground uppercase">Tokens</p></div><div><p className="font-mono text-sm">{lastRun ? formatLatency(lastRun.latency_ms) : "—"}</p><p className="mt-1 text-[10px] text-muted-foreground uppercase">Latency</p></div><div><p className="font-mono text-sm">{lastRun ? formatCost(lastRun.cost_usd) : "—"}</p><p className="mt-1 text-[10px] text-muted-foreground uppercase">Cost</p></div></CardContent></Card>
                <Card className="mt-4 border" size="sm"><CardContent className="text-[11px] leading-5 text-muted-foreground">{lastRun ? `${lastRun.token_source} token counts · ${lastRun.mode} mode` : "Run a prompt to populate observed telemetry."}</CardContent></Card>
              </TabsContent>
            </Tabs>
          </div>
        </aside>
      </div>

      {isNavigationOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-foreground/20" onClick={() => setIsNavigationOpen(false)} aria-label="Close navigation" /><aside className="relative flex h-full w-[min(20rem,88vw)] flex-col border-r bg-background p-3"><div className="mb-4 flex items-center justify-between"><p className="text-sm font-semibold">Workspace</p><Button onPress={() => setIsNavigationOpen(false)} variant="ghost" size="icon-sm" aria-label="Close navigation"><X /></Button></div><SidebarContent activeNav={activeNav} conversationId={conversationId} conversations={conversations} conversationSearch={conversationSearch} onConversationSearchChange={setConversationSearch} onNavigate={navigate} onOpenConversation={(id) => void openConversation(id)} onStartNewRun={openNewRun} /></aside></div>}
    </main>
  )
}
