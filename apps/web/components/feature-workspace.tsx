"use client"

import { type FormEvent, useEffect, useMemo, useState } from "react"
import { BarChart3, BookOpen, CheckCircle2, Download, GitCompare, ListChecks, Plus, RefreshCw, RotateCcw, Save, XCircle } from "lucide-react"

import { QualityWorkspace, type QualityView } from "@/components/quality-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export type FeatureView = "Compare models" | "Prompt library" | "Cost analytics" | "Evaluations" | "Exports" | QualityView

type Provider = { id: string; name: string; model: string; configured: boolean }
type Conversation = { id: string; title: string; updated_at: string }
type RunMode = "demo" | "live"

type ComparisonResult = { id: string; provider: string; model: string; response: string; status: "complete" | "error"; latency_ms: number; prompt_tokens: number; completion_tokens: number; cost_usd: number | null; error?: string | null }
type Comparison = { id: string; title: string; prompt: string; system_prompt: string; mode: RunMode; created_at: string; results: ComparisonResult[] }
type PromptRevision = { id: string; version: number; content: string; system_prompt: string; change_note?: string | null; created_at: string }
type PromptTemplate = { id: string; title: string; description: string; category: string; tags: string[]; content: string; system_prompt: string; latest_version: number; updated_at: string; revisions: PromptRevision[] }
type CostBreakdown = { provider: string; model: string; runs: number; tokens: number; total_cost_usd: number | null; average_latency_ms: number }
type CostAnalytics = { total_runs: number; total_tokens: number; total_cost_usd: number | null; by_model: CostBreakdown[] }
type EvaluationResult = { id: string; assertion_type: string; expected: string | null; passed: boolean; detail: string }
type Evaluation = { id: string; title: string; passed: boolean; created_at: string; results: EvaluationResult[] }

type PromptDraft = { title: string; description: string; category: string; tags: string; content: string; system_prompt: string }

const blankDraft: PromptDraft = { title: "", description: "", category: "General", tags: "", content: "", system_prompt: "You are a helpful assistant." }

function formatCost(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(value < 0.01 ? 4 : 2)}`
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The API could not complete this request."
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, options)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? "Request failed.")
  }
  return response.json() as Promise<T>
}

function FeatureWorkspaceContent({ view, providers, conversations, onUsePrompt, onRefresh }: { view: FeatureView; providers: Provider[]; conversations: Conversation[]; onUsePrompt: (content: string, systemPrompt: string) => void; onRefresh: () => Promise<void> }) {
  const [notice, setNotice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [comparisons, setComparisons] = useState<Comparison[]>([])
  const [comparisonPrompt, setComparisonPrompt] = useState("Explain a safe canary deployment strategy for a production API.")
  const [comparisonSystem, setComparisonSystem] = useState("You are a senior platform engineer. Be concise and concrete.")
  const [comparisonMode, setComparisonMode] = useState<RunMode>("demo")
  const [selectedTargets, setSelectedTargets] = useState<string[]>(["openai", "anthropic"])
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<PromptTemplate | null>(null)
  const [draft, setDraft] = useState<PromptDraft>(blankDraft)
  const [analytics, setAnalytics] = useState<CostAnalytics | null>(null)
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [evaluationTitle, setEvaluationTitle] = useState("Response evaluation")
  const [evaluationOutput, setEvaluationOutput] = useState("")
  const [assertionType, setAssertionType] = useState("contains")
  const [assertionValue, setAssertionValue] = useState("")
  const [exportConversationId, setExportConversationId] = useState("")
  const [exportFormat, setExportFormat] = useState("markdown")

  const selectedProviderTargets = useMemo(() => providers.filter((provider) => selectedTargets.includes(provider.id)), [providers, selectedTargets])

  async function loadComparisons() {
    const data = await requestJson<Comparison[]>("/api/comparisons")
    setComparisons(data)
  }

  async function loadPrompts() {
    const data = await requestJson<PromptTemplate[]>("/api/prompts")
    setPrompts(data)
  }

  async function loadAnalytics() {
    setAnalytics(await requestJson<CostAnalytics>("/api/analytics/costs"))
  }

  async function loadEvaluations() {
    setEvaluations(await requestJson<Evaluation[]>("/api/evaluations"))
  }

  useEffect(() => {
    const load = async () => {
      setNotice(null)
      try {
        if (view === "Compare models") await loadComparisons()
        if (view === "Prompt library") await loadPrompts()
        if (view === "Cost analytics") await loadAnalytics()
        if (view === "Evaluations") await loadEvaluations()
      } catch (error) {
        setNotice(errorText(error))
      }
    }
    void load()
  }, [view])

  function toggleTarget(id: string) {
    setSelectedTargets((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current)
  }

  async function submitComparison(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedProviderTargets.length < 2) {
      setNotice("Choose at least two provider targets.")
      return
    }
    setIsLoading(true)
    setNotice(null)
    try {
      const result = await requestJson<Comparison>("/api/comparisons", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: comparisonPrompt.slice(0, 80) || "Model comparison", prompt: comparisonPrompt, system_prompt: comparisonSystem, mode: comparisonMode, targets: selectedProviderTargets.map((provider) => ({ provider: provider.id, model: provider.model })) }),
      })
      setComparisons((current) => [result, ...current])
      await onRefresh()
    } catch (error) {
      setNotice(errorText(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function selectPrompt(id: string) {
    try {
      const prompt = await requestJson<PromptTemplate>(`/api/prompts/${id}`)
      setSelectedPrompt(prompt)
      setDraft({ title: prompt.title, description: prompt.description, category: prompt.category, tags: prompt.tags.join(", "), content: prompt.content, system_prompt: prompt.system_prompt })
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  function newPrompt() {
    setSelectedPrompt(null)
    setDraft(blankDraft)
    setNotice(null)
  }

  async function savePrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setNotice(null)
    const body = { title: draft.title, description: draft.description, category: draft.category, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), content: draft.content, system_prompt: draft.system_prompt, change_note: selectedPrompt ? "Edited in workspace" : "Initial version" }
    try {
      const saved = await requestJson<PromptTemplate>(selectedPrompt ? `/api/prompts/${selectedPrompt.id}` : "/api/prompts", { method: selectedPrompt ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      setSelectedPrompt(saved)
      setPrompts((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
      setNotice(`Saved ${saved.title} as version ${saved.latest_version}.`)
    } catch (error) {
      setNotice(errorText(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function restoreRevision(version: number) {
    if (!selectedPrompt) return
    setIsLoading(true)
    try {
      const restored = await requestJson<PromptTemplate>(`/api/prompts/${selectedPrompt.id}/revisions/${version}/restore`, { method: "POST" })
      setSelectedPrompt(restored)
      setDraft({ title: restored.title, description: restored.description, category: restored.category, tags: restored.tags.join(", "), content: restored.content, system_prompt: restored.system_prompt })
      setPrompts((current) => [restored, ...current.filter((item) => item.id !== restored.id)])
      setNotice(`Restored version ${version} into new version ${restored.latest_version}.`)
    } catch (error) {
      setNotice(errorText(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setNotice(null)
    try {
      const result = await requestJson<Evaluation>("/api/evaluations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: evaluationTitle, output: evaluationOutput, assertions: [{ type: assertionType, value: assertionType === "json_valid" ? null : assertionValue }] }) })
      setEvaluations((current) => [result, ...current])
    } catch (error) {
      setNotice(errorText(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function exportConversation() {
    if (!exportConversationId) {
      setNotice("Choose a saved run to export.")
      return
    }
    setIsLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/exports/conversations/${exportConversationId}?format=${exportFormat}`)
      if (!response.ok) throw new Error("The selected run could not be exported.")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `promptdeck-export.${exportFormat === "markdown" ? "md" : exportFormat}`
      link.click()
      URL.revokeObjectURL(url)
      setNotice("Download started.")
    } catch (error) {
      setNotice(errorText(error))
    } finally {
      setIsLoading(false)
    }
  }

  const header = view === "Compare models" ? { icon: GitCompare, title: "Compare models", description: "Run the same resolved prompt across providers and retain observed outcomes." } : view === "Prompt library" ? { icon: BookOpen, title: "Prompt library", description: "Store reusable templates with version history and one-click rollback." } : view === "Cost analytics" ? { icon: BarChart3, title: "Cost analytics", description: "Aggregate tokens, latency, and estimated known-model spend across runs and comparisons." } : view === "Evaluations" ? { icon: ListChecks, title: "Evaluations", description: "Persist deterministic assertions against a response for repeatable checks." } : { icon: Download, title: "Exports", description: "Download a saved conversation and its run telemetry in a portable format." }
  const HeaderIcon = header.icon

  return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><HeaderIcon className="size-4" /><h1 className="text-lg font-semibold tracking-tight">{header.title}</h1></div><p className="mt-1 text-xs text-muted-foreground">{header.description}</p></div>{view !== "Exports" && <Button onPress={() => { if (view === "Compare models") void loadComparisons(); if (view === "Prompt library") void loadPrompts(); if (view === "Cost analytics") void loadAnalytics(); if (view === "Evaluations") void loadEvaluations() }} variant="outline" size="sm" isDisabled={isLoading}><RefreshCw className={isLoading ? "animate-spin" : ""} /> Refresh</Button>}</div>
    {notice && <div className="mt-4 border bg-muted px-3 py-2 text-xs">{notice}</div>}

    {view === "Compare models" && <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]"><form onSubmit={submitComparison} className="space-y-4"><Card className="border"><CardHeader className="border-b"><CardTitle>New comparison</CardTitle><CardDescription>Demo mode is deterministic. Live mode only runs configured providers.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4"><label className="block text-xs font-medium">Prompt<Textarea value={comparisonPrompt} onChange={(event) => setComparisonPrompt(event.target.value)} className="mt-2 h-28 resize-none" /></label><label className="block text-xs font-medium">System instruction<Textarea value={comparisonSystem} onChange={(event) => setComparisonSystem(event.target.value)} className="mt-2 h-20 resize-none" /></label><label className="block text-xs font-medium">Mode<select value={comparisonMode} onChange={(event) => setComparisonMode(event.target.value as RunMode)} className="mt-2 h-9 w-full border bg-background px-2 text-xs"><option value="demo">Demo</option><option value="live">Live</option></select></label><div><p className="text-xs font-medium">Targets <span className="text-muted-foreground">({selectedTargets.length}/5)</span></p><div className="mt-2 grid gap-2">{providers.map((provider) => <button type="button" onClick={() => toggleTarget(provider.id)} key={provider.id} className={`flex items-center justify-between border px-2.5 py-2 text-left text-xs ${selectedTargets.includes(provider.id) ? "border-foreground bg-muted" : "hover:bg-muted/50"}`}><span>{provider.name} · <span className="font-mono">{provider.model}</span></span>{selectedTargets.includes(provider.id) && <CheckCircle2 className="size-3.5" />}</button>)}</div></div><Button type="submit" className="w-full" isDisabled={isLoading || selectedTargets.length < 2}><GitCompare /> {isLoading ? "Comparing…" : "Compare selected"}</Button></CardContent></Card></form><div className="space-y-4">{comparisons.length ? comparisons.map((comparison) => <Card key={comparison.id} className="border"><CardHeader className="border-b"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-sm">{comparison.title}</CardTitle><Badge variant="outline">{comparison.mode} · {comparison.results.length} models</Badge></div><CardDescription className="line-clamp-2">{comparison.prompt}</CardDescription></CardHeader><CardContent className="grid gap-3 pt-4 lg:grid-cols-2">{comparison.results.map((result) => <article key={result.id} className="border bg-muted/20 p-3"><div className="flex items-center justify-between gap-2"><p className="font-mono text-xs font-medium">{result.provider} / {result.model}</p><Badge variant={result.status === "complete" ? "secondary" : "destructive"}>{result.status}</Badge></div><p className="mt-2 line-clamp-6 whitespace-pre-wrap text-xs leading-5">{result.error ?? result.response}</p><div className="mt-3 flex gap-3 text-[10px] text-muted-foreground"><span>{(result.latency_ms / 1000).toFixed(1)}s</span><span>{formatTokens(result.prompt_tokens + result.completion_tokens)} tokens</span><span>{formatCost(result.cost_usd)}</span></div></article>)}</CardContent></Card>) : <Card className="border"><CardContent className="py-12 text-center text-xs text-muted-foreground">Run a comparison to retain side-by-side responses and telemetry.</CardContent></Card>}</div></div>}

    {view === "Prompt library" && <div className="mt-6 grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_240px]"><div><Button onPress={newPrompt} size="sm" className="w-full"><Plus /> New template</Button><div className="mt-3 space-y-2">{prompts.length ? prompts.map((prompt) => <button key={prompt.id} onClick={() => void selectPrompt(prompt.id)} className={`w-full border p-3 text-left ${selectedPrompt?.id === prompt.id ? "border-foreground bg-muted" : "hover:bg-muted/50"}`}><p className="truncate text-xs font-medium">{prompt.title}</p><p className="mt-1 text-[10px] text-muted-foreground">{prompt.category} · v{prompt.latest_version}</p></button>) : <p className="border border-dashed p-3 text-xs text-muted-foreground">Save a template to build your library.</p>}</div></div><form onSubmit={savePrompt}><Card className="border"><CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><CardTitle>{selectedPrompt ? "Edit template" : "New template"}</CardTitle>{selectedPrompt && <Badge variant="outline">v{selectedPrompt.latest_version}</Badge>}</div><CardDescription>Changes to prompt text or system instructions create a new revision.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Name<Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-2" required /></label><label className="text-xs font-medium">Category<Input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} className="mt-2" required /></label></div><label className="block text-xs font-medium">Description<Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="mt-2" /></label><label className="block text-xs font-medium">Tags <span className="text-muted-foreground">(comma separated)</span><Input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} className="mt-2" placeholder="kubernetes, deployment" /></label><label className="block text-xs font-medium">Prompt<Textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} className="mt-2 h-40 resize-y font-mono text-xs" required /></label><label className="block text-xs font-medium">System instruction<Textarea value={draft.system_prompt} onChange={(event) => setDraft({ ...draft, system_prompt: event.target.value })} className="mt-2 h-24 resize-y font-mono text-xs" /></label><div className="flex flex-wrap gap-2"><Button type="submit" isDisabled={isLoading}><Save /> {isLoading ? "Saving…" : "Save version"}</Button>{selectedPrompt && <Button type="button" variant="outline" onPress={() => onUsePrompt(draft.content, draft.system_prompt)}>Use in playground</Button>}</div></CardContent></Card></form><div><p className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Version history</p><div className="mt-3 space-y-2">{selectedPrompt?.revisions.length ? selectedPrompt.revisions.map((revision) => <Card key={revision.id} size="sm" className="border"><CardContent><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">Version {revision.version}</p>{revision.version !== selectedPrompt.latest_version && <Button onPress={() => void restoreRevision(revision.version)} variant="ghost" size="sm" isDisabled={isLoading}><RotateCcw /> Restore</Button>}</div><p className="mt-1 text-[10px] text-muted-foreground">{revision.change_note ?? "Saved revision"}</p></CardContent></Card>) : <p className="text-xs text-muted-foreground">Select a template to inspect its revisions.</p>}</div></div></div>}

    {view === "Cost analytics" && <div className="mt-6">{analytics ? <><div className="grid gap-px border bg-border sm:grid-cols-3"><div className="bg-card p-4"><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Executed runs</p><p className="mt-2 font-mono text-xl">{analytics.total_runs}</p></div><div className="bg-card p-4"><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Tokens</p><p className="mt-2 font-mono text-xl">{formatTokens(analytics.total_tokens)}</p></div><div className="bg-card p-4"><p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Known-model estimate</p><p className="mt-2 font-mono text-xl">{formatCost(analytics.total_cost_usd)}</p></div></div><Card className="mt-6 border"><CardHeader className="border-b"><CardTitle>Usage by provider and model</CardTitle><CardDescription>Costs are token-based estimates for catalogued models; unknown/local model costs remain unavailable.</CardDescription></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[600px] text-left text-xs"><thead className="border-b bg-muted/35 text-[10px] tracking-[0.1em] text-muted-foreground uppercase"><tr><th className="p-3">Provider / model</th><th className="p-3 text-right">Runs</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Average latency</th><th className="p-3 text-right">Cost</th></tr></thead><tbody>{analytics.by_model.map((item) => <tr key={`${item.provider}-${item.model}`} className="border-b last:border-0"><td className="p-3"><span className="font-medium">{item.provider}</span> <span className="font-mono text-muted-foreground">/ {item.model}</span></td><td className="p-3 text-right font-mono">{item.runs}</td><td className="p-3 text-right font-mono">{formatTokens(item.tokens)}</td><td className="p-3 text-right font-mono">{(item.average_latency_ms / 1000).toFixed(1)}s</td><td className="p-3 text-right font-mono">{formatCost(item.total_cost_usd)}</td></tr>)}</tbody></table>{!analytics.by_model.length && <p className="p-8 text-center text-xs text-muted-foreground">Run a prompt or comparison to populate cost analytics.</p>}</CardContent></Card></> : <Card className="border"><CardContent className="py-10 text-center text-xs text-muted-foreground">Loading analytics…</CardContent></Card>}</div>}

    {view === "Evaluations" && <div className="mt-6 grid gap-6 lg:grid-cols-[390px_minmax(0,1fr)]"><form onSubmit={submitEvaluation}><Card className="border"><CardHeader className="border-b"><CardTitle>Evaluate a response</CardTitle><CardDescription>Store an assertion result for a model response or manually supplied text.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4"><label className="block text-xs font-medium">Evaluation name<Input value={evaluationTitle} onChange={(event) => setEvaluationTitle(event.target.value)} className="mt-2" /></label><label className="block text-xs font-medium">Response under test<Textarea value={evaluationOutput} onChange={(event) => setEvaluationOutput(event.target.value)} className="mt-2 h-40 resize-y" required /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium">Assertion<select value={assertionType} onChange={(event) => setAssertionType(event.target.value)} className="mt-2 h-9 w-full border bg-background px-2 text-xs"><option value="contains">Contains text</option><option value="not_contains">Does not contain</option><option value="equals">Equals</option><option value="json_valid">Valid JSON</option><option value="max_length">Maximum length</option></select></label>{assertionType !== "json_valid" && <label className="text-xs font-medium">Expected {assertionType === "max_length" ? "characters" : "value"}<Input value={assertionValue} onChange={(event) => setAssertionValue(event.target.value)} className="mt-2" required /></label>}</div><Button type="submit" className="w-full" isDisabled={isLoading}><ListChecks /> {isLoading ? "Evaluating…" : "Run evaluation"}</Button></CardContent></Card></form><div className="space-y-3">{evaluations.length ? evaluations.map((evaluation) => <Card key={evaluation.id} className="border"><CardContent><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">{evaluation.title}</p><Badge variant={evaluation.passed ? "secondary" : "destructive"}>{evaluation.passed ? "Passed" : "Failed"}</Badge></div><div className="mt-3 space-y-2">{evaluation.results.map((result) => <div key={result.id} className="flex gap-2 border-l-2 border-muted pl-2 text-xs"><span className={result.passed ? "text-emerald-600" : "text-destructive"}>{result.passed ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}</span><div><p className="font-medium">{result.assertion_type}</p><p className="mt-0.5 text-muted-foreground">{result.detail}</p></div></div>)}</div></CardContent></Card>) : <Card className="border"><CardContent className="py-12 text-center text-xs text-muted-foreground">Run a deterministic check to create an evaluation record.</CardContent></Card>}</div></div>}

    {view === "Exports" && <div className="mt-6 max-w-2xl"><Card className="border"><CardHeader className="border-b"><CardTitle>Export a saved run</CardTitle><CardDescription>Each file includes conversation messages; Markdown, CSV, and JSON also include persisted telemetry where applicable.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4"><label className="block text-xs font-medium">Saved run<select value={exportConversationId} onChange={(event) => setExportConversationId(event.target.value)} className="mt-2 h-9 w-full border bg-background px-2 text-xs"><option value="">Choose a run…</option>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label><label className="block text-xs font-medium">Format<select value={exportFormat} onChange={(event) => setExportFormat(event.target.value)} className="mt-2 h-9 w-full border bg-background px-2 text-xs"><option value="markdown">Markdown (.md)</option><option value="json">JSON (.json)</option><option value="csv">CSV (.csv)</option><option value="html">HTML (.html)</option></select></label><Button onPress={() => void exportConversation()} isDisabled={isLoading || !conversations.length}><Download /> {isLoading ? "Preparing…" : "Download export"}</Button>{!conversations.length && <p className="text-xs text-muted-foreground">Run and save a prompt before exporting it.</p>}</CardContent></Card></div>}
  </div></div>
}



export function FeatureWorkspace(props: { view: FeatureView; providers: Provider[]; conversations: Conversation[]; onUsePrompt: (content: string, systemPrompt: string) => void; onRefresh: () => Promise<void> }) {
  if (props.view === "Test suites" || props.view === "Safety checks") {
    return <QualityWorkspace view={props.view} providers={props.providers} onRefresh={props.onRefresh} onUsePrompt={(content) => props.onUsePrompt(content, "You are a helpful assistant.")} />
  }
  return <FeatureWorkspaceContent {...props} />
}
