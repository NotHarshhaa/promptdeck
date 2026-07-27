"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Command,
  Copy,
  FileText,
  Flame,
  Gauge,
  LayoutDashboard,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  SendHorizontal,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Upload,
  UserRound,
  Variable,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type Provider = {
  id: string
  name: string
  model: string
  color: string
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  model?: string
  status?: "streaming" | "complete"
}

const fallbackProviders: Provider[] = [
  { id: "openai", name: "OpenAI", model: "gpt-4o", color: "#10a37f" },
  { id: "anthropic", name: "Anthropic", model: "claude-3-5-sonnet", color: "#d97757" },
  { id: "google", name: "Google", model: "gemini-1.5-pro", color: "#4285f4" },
  { id: "groq", name: "Groq", model: "llama-3.3-70b", color: "#f55036" },
  { id: "ollama", name: "Ollama", model: "llama3.2", color: "#a8a29e" },
]

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    model: "PromptDeck",
    content:
      "Welcome to your playground. Choose a model, tune the controls, and run a prompt. Your responses will stream here in real time.",
    status: "complete",
  },
]

const navigation = [
  { label: "Playground", icon: LayoutDashboard },
  { label: "Compare", icon: PanelLeft, badge: "NEW" },
  { label: "Prompt library", icon: BookOpen },
  { label: "Evaluations", icon: Gauge },
  { label: "Usage & costs", icon: Flame },
]

const conversationItems = [
  "Kubernetes deployment strategy",
  "Terraform module review",
  "Postgres performance debugging",
  "Incident response runbook",
]

export default function Page() {
  const [providers, setProviders] = useState<Provider[]>(fallbackProviders)
  const [selectedProviderId, setSelectedProviderId] = useState("openai")
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [prompt, setPrompt] = useState("Design a resilient deployment strategy for a Python API running on Kubernetes.")
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a senior platform engineer. Give practical, concise answers with clear trade-offs.",
  )
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeNav, setActiveNav] = useState("Playground")
  const [conversationName, setConversationName] = useState("Kubernetes deployment strategy")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  const provider = useMemo(
    () => providers.find((item) => item.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  )

  useEffect(() => {
    fetch(`${API_URL}/api/providers`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Unavailable"))))
      .then((data: Provider[]) => {
        if (Array.isArray(data) && data.length) {
          setProviders(data)
          setSelectedProviderId((current) =>
            data.some((item) => item.id === current) ? current : data[0].id,
          )
        }
      })
      .catch(() => undefined)
  }, [])

  async function copyMessage(message: ChatMessage) {
    await navigator.clipboard?.writeText(message.content)
    setCopiedId(message.id)
    window.setTimeout(() => setCopiedId(null), 1600)
  }

  function startNewChat() {
    setMessages(initialMessages)
    setConversationName("Untitled playground")
    setPrompt("")
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isStreaming || !provider) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedPrompt,
      status: "complete",
    }
    const assistantId = `assistant-${Date.now()}`
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", model: provider.model, status: "streaming" },
    ])
    setPrompt("")
    setIsStreaming(true)

    try {
      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          model: provider.model,
          prompt: trimmedPrompt,
          system_prompt: systemPrompt,
          temperature,
          max_tokens: maxTokens,
        }),
      })
      if (!response.ok || !response.body) throw new Error("The API did not return a stream.")

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
        for (const eventBlock of events) {
          const dataLine = eventBlock.split("\n").find((line) => line.startsWith("data: "))
          if (!dataLine) continue
          const payload = JSON.parse(dataLine.slice(6)) as { type: string; content?: string }
          if (payload.type === "token") {
            answer += payload.content ?? ""
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, content: answer } : message,
              ),
            )
          }
        }
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, status: "complete" } : message,
        ),
      )
    } catch {
      const fallback =
        "The local API is unavailable. Start FastAPI on port 8000, then run this prompt again. Your editor settings are preserved."
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: fallback, status: "complete" }
            : message,
        ),
      )
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <main className="min-h-svh bg-[#f8f8f6] text-[#1d2522]">
      <div className="flex min-h-svh">
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#e7e9e5] bg-white px-3 py-4 lg:flex">
          <div className="mb-8 flex items-center gap-2.5 px-2">
            <div className="grid size-8 place-items-center rounded-lg bg-[#263c34] text-sm font-bold text-[#f2e7bc]">P</div>
            <span className="text-lg font-bold tracking-[-0.04em]">PromptDeck</span>
          </div>
          <Button onPress={startNewChat} className="mb-5 h-10 w-full justify-start rounded-lg bg-[#263c34] px-3 text-white hover:bg-[#354c43]">
            <MessageSquarePlus className="size-4" />
            New playground
            <Command className="ml-auto size-3.5 text-white/50" />
          </Button>
          <nav className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon
              const active = item.label === activeNav
              return (
                <button
                  key={item.label}
                  onClick={() => setActiveNav(item.label)}
                  className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors ${active ? "bg-[#edf1e9] font-semibold text-[#253d34]" : "text-[#69736e] hover:bg-[#f5f6f3] hover:text-[#253d34]"}`}
                >
                  <Icon className="size-4" />
                  {item.label}
                  {item.badge && <span className="ml-auto rounded bg-[#e6eee4] px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-[#52705b]">{item.badge}</span>}
                </button>
              )
            })}
          </nav>
          <div className="mt-7 px-3 text-[10px] font-semibold tracking-[0.12em] text-[#9aa19d] uppercase">Recent playgrounds</div>
          <div className="mt-2 space-y-0.5">
            {conversationItems.map((item, index) => (
              <button
                key={item}
                onClick={() => setConversationName(item)}
                className={`group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] ${item === conversationName ? "bg-[#f5f6f3] text-[#30453c]" : "text-[#77807b] hover:bg-[#f5f6f3]"}`}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{item}</span>
                {index === 0 && <span className="ml-auto size-1.5 rounded-full bg-[#84b58d]" />}
              </button>
            ))}
          </div>
          <div className="mt-auto border-t border-[#edf0ec] pt-4">
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] text-[#68736d] hover:bg-[#f5f6f3]">
              <Settings2 className="size-4" /> Settings
            </button>
            <div className="mt-4 flex items-center gap-2 px-2">
              <div className="grid size-7 place-items-center rounded-full bg-[#e5dac9] text-[11px] font-bold text-[#765e45]">AM</div>
              <div className="min-w-0"><p className="truncate text-[12px] font-semibold">Alex Morgan</p><p className="text-[10px] text-[#8b938e]">Personal workspace</p></div>
              <MoreHorizontal className="ml-auto size-4 text-[#929a95]" />
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#e7e9e5] bg-white px-4 sm:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <button className="grid size-8 place-items-center rounded-md hover:bg-[#f2f4ef] lg:hidden" aria-label="Open navigation"><PanelLeft className="size-4" /></button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5"><h1 className="truncate text-sm font-semibold">{conversationName}</h1><ChevronDown className="size-3.5 text-[#8e9792]" /></div>
                <p className="hidden text-[11px] text-[#919a95] sm:block">Playground <span className="mx-1">/</span> Chat</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button className="hidden size-8 place-items-center rounded-md text-[#747f79] hover:bg-[#f4f5f2] sm:grid" aria-label="Search"><Search className="size-4" /></button>
              <Button variant="outline" size="sm" className="hidden rounded-md border-[#e0e5df] text-xs sm:inline-flex"><Upload className="size-3.5" /> Share</Button>
              <Button size="sm" className="rounded-md bg-[#263c34] px-3 text-xs text-white hover:bg-[#354c43]"><Plus className="size-3.5" /> New</Button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
            <section className="order-2 flex min-w-0 flex-1 flex-col xl:order-1">
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#eceeea] bg-[#fbfcfa] px-4 sm:px-7">
                <div className="flex items-center gap-2 text-[11px] text-[#7e8882]"><MessageSquarePlus className="size-3.5" /><span>Chat</span><span className="text-[#bec4bf]">/</span><span>Run 01</span></div>
                <div className="flex items-center gap-3 text-[10px] text-[#89928d]"><span className="flex items-center gap-1"><Clock3 className="size-3" /> 2.4s avg</span><span className="hidden sm:inline">$0.0042 total</span></div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-7 sm:px-9 lg:px-12">
                <div className="mx-auto max-w-3xl space-y-7">
                  {messages.map((message) => (
                    <article key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}>
                      {message.role === "assistant" && (
                        <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#263c34] text-[10px] font-bold text-[#f3e8bb]">P</div>
                      )}
                      <div className={message.role === "user" ? "max-w-[80%]" : "min-w-0 flex-1"}>
                        <div className="mb-1.5 flex items-center gap-2 text-[11px] text-[#8a938e]">
                          <span className="font-semibold text-[#59645f]">{message.role === "user" ? "You" : message.model ?? provider?.name}</span>
                          {message.role === "assistant" && <span className="rounded bg-[#edf1e9] px-1.5 py-0.5 text-[9px] text-[#62756a]">{message.model ?? provider?.model}</span>}
                        </div>
                        <div className={`whitespace-pre-wrap text-[13px] leading-6 ${message.role === "user" ? "rounded-2xl rounded-tr-sm bg-[#e9efe8] px-4 py-3 text-[#284037]" : "text-[#36433d]"}`}>
                          {message.content || <span className="inline-flex gap-1 pt-1"><i className="size-1.5 animate-bounce rounded-full bg-[#779081]" /><i className="size-1.5 animate-bounce rounded-full bg-[#779081] [animation-delay:150ms]" /><i className="size-1.5 animate-bounce rounded-full bg-[#779081] [animation-delay:300ms]" /></span>}
                        </div>
                        {message.role === "assistant" && message.status === "complete" && message.content && (
                          <div className="mt-2 flex items-center gap-1">
                            <button onClick={() => copyMessage(message)} className="grid size-6 place-items-center rounded text-[#9ba39e] hover:bg-[#eef1ed] hover:text-[#53615a]" aria-label="Copy response">{copiedId === message.id ? <Check className="size-3.5 text-[#51825d]" /> : <Copy className="size-3.5" />}</button>
                            <button className="grid size-6 place-items-center rounded text-[#9ba39e] hover:bg-[#eef1ed] hover:text-[#53615a]" aria-label="Regenerate response"><Zap className="size-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {message.role === "user" && <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#e5dac9] text-[10px] font-bold text-[#765e45]"><UserRound className="size-3.5" /></div>}
                    </article>
                  ))}
                </div>
              </div>

              <form onSubmit={submitPrompt} className="border-t border-[#e7eae5] bg-white px-4 pb-4 pt-3 sm:px-7">
                <div className="mx-auto max-w-3xl rounded-xl border border-[#dfe5dd] bg-white shadow-[0_8px_24px_rgba(44,62,52,0.06)] focus-within:border-[#96af9b] focus-within:ring-3 focus-within:ring-[#e5eee5]">
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Ask anything or paste a prompt…" className="h-[72px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-5 outline-none placeholder:text-[#a0a8a2]" />
                  <div className="flex items-center justify-between border-t border-[#edf0eb] px-2 py-1.5">
                    <div className="flex items-center gap-0.5"><button type="button" className="grid size-7 place-items-center rounded-md text-[#89938d] hover:bg-[#f1f4ef]" aria-label="Add variable"><Variable className="size-3.5" /></button><button type="button" className="grid size-7 place-items-center rounded-md text-[#89938d] hover:bg-[#f1f4ef]" aria-label="Attach content"><Plus className="size-4" /></button></div>
                    <div className="flex items-center gap-2"><span className="hidden text-[10px] text-[#a1a8a3] sm:inline">⌘ Enter to run</span><Button type="submit" isDisabled={!prompt.trim() || isStreaming} size="sm" className="h-7 rounded-md bg-[#263c34] px-2.5 text-xs text-white hover:bg-[#354c43]">{isStreaming ? <><span className="size-2 animate-pulse rounded-full bg-white" /> Running</> : <><SendHorizontal className="size-3.5" /> Run</>}</Button></div>
                  </div>
                </div>
              </form>
            </section>

            <aside className="order-1 h-auto shrink-0 border-b border-[#e7e9e5] bg-white xl:order-2 xl:h-auto xl:w-[310px] xl:border-b-0 xl:border-l">
              <div className="flex h-12 items-center justify-between border-b border-[#ecefe9] px-4"><div className="flex items-center gap-2 text-[12px] font-semibold"><SlidersHorizontal className="size-3.5 text-[#657d6b]" /> Run settings</div><button onClick={() => setIsAdvancedOpen((value) => !value)} className="text-[10px] font-medium text-[#63846b]">{isAdvancedOpen ? "Hide" : "Advanced"}</button></div>
              <div className="grid grid-cols-2 gap-4 p-4 xl:block xl:space-y-5">
                <div className="col-span-2"><label className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-[#89928d] uppercase">Provider</label><div className="relative"><select value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)} className="h-9 w-full appearance-none rounded-lg border border-[#e0e5df] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#8eaa94] focus:ring-3 focus:ring-[#eaf1e9]">{providers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-[#89938e]" /></div><div className="mt-2 flex items-center gap-2 text-[10px] text-[#82908a]"><span className="size-1.5 rounded-full" style={{ backgroundColor: provider?.color }} /> Connected via local gateway</div></div>
                <div><label className="mb-1.5 block text-[10px] font-semibold tracking-[0.08em] text-[#89928d] uppercase">Model</label><div className="flex h-9 items-center gap-2 rounded-lg border border-[#e0e5df] bg-[#fafbf9] px-3 font-mono text-[11px] text-[#4d5b54]"><Bot className="size-3.5 text-[#819087]" />{provider?.model}</div></div>
                <div><div className="mb-1.5 flex justify-between text-[10px] font-semibold tracking-[0.08em] text-[#89928d] uppercase"><span>Temperature</span><span className="normal-case text-[#61746a]">{temperature.toFixed(1)}</span></div><input aria-label="Temperature" type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} className="accent-[#54745d] w-full" /></div>
                <div><div className="mb-1.5 flex justify-between text-[10px] font-semibold tracking-[0.08em] text-[#89928d] uppercase"><span>Max tokens</span><span className="normal-case text-[#61746a]">{maxTokens}</span></div><input aria-label="Maximum tokens" type="range" min="256" max="4096" step="256" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} className="accent-[#54745d] w-full" /></div>
                <div className="col-span-2"><label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[#89928d] uppercase"><Sparkles className="size-3 text-[#718f75]" /> System instructions</label><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} className="h-20 w-full resize-none rounded-lg border border-[#e0e5df] bg-[#fafbf9] p-2.5 text-[11px] leading-5 text-[#56645d] outline-none focus:border-[#8eaa94] focus:ring-3 focus:ring-[#eaf1e9]" /></div>
                {isAdvancedOpen && <div className="col-span-2 rounded-lg border border-dashed border-[#dbe3d9] bg-[#fafcf9] p-3 text-[11px] leading-5 text-[#718078]
                "><div className="mb-2 flex items-center gap-1.5 font-semibold text-[#526258]"><Code2 className="size-3.5" /> Request preview</div><code className="block break-all font-mono text-[9px] text-[#829087]">POST /api/chat/stream</code><p className="mt-1">Streaming enabled · Mock gateway mode</p></div>}
              </div>
              <div className="border-t border-[#ecefe9] px-4 py-3"><div className="mb-2 flex items-center justify-between text-[10px] font-semibold tracking-[0.08em] text-[#89928d] uppercase"><span>Current run</span><span className="font-normal tracking-normal text-[#6d7b73]">Estimated</span></div><div className="grid grid-cols-3 divide-x divide-[#e6ebe5] rounded-lg border border-[#e6ebe5] bg-[#fcfdfb] py-2"><div className="px-2 text-center"><p className="text-[12px] font-semibold">642</p><p className="text-[9px] text-[#919a94]">tokens</p></div><div className="px-2 text-center"><p className="text-[12px] font-semibold">$0.004</p><p className="text-[9px] text-[#919a94]">cost</p></div><div className="px-2 text-center"><p className="text-[12px] font-semibold">~2.4s</p><p className="text-[9px] text-[#919a94]">latency</p></div></div></div>
              <div className="flex items-center gap-2 border-t border-[#ecefe9] px-4 py-3 text-[10px] text-[#84908a]"><TerminalSquare className="size-3.5" /><span>Mock gateway running locally</span><span className="ml-auto size-1.5 rounded-full bg-[#75a77d]" /></div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  )
}
