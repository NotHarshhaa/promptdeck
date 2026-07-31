"use client"

import { type FormEvent, useEffect, useMemo, useState } from "react"
import { CheckCircle2, ListChecks, Play, Plus, Save, ShieldCheck, Trash2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export type QualityView = "Test suites" | "Safety checks"
type Provider = { id: string; name: string; model: string; configured: boolean }
type RunMode = "demo" | "live"
type Outcome = { assertion_type: string; expected: string | null; passed: boolean; detail: string }
type CaseRun = { id: string; case_id: string; case_name: string; response: string; status: "complete" | "error"; passed: boolean; latency_ms: number; prompt_tokens: number; completion_tokens: number; error?: string | null; outcomes: Outcome[] }
type SuiteRun = { id: string; provider: string; model: string; mode: RunMode; status: "complete" | "error"; total_cases: number; passed_cases: number; failed_cases: number; created_at: string; case_runs: CaseRun[] }
type TestCase = { id: string; name: string; input: string; assertions: { type: string; value: string | null }[] }
type Suite = { id: string; title: string; description: string; prompt_template: string; system_prompt: string; cases: TestCase[]; runs: SuiteRun[] }
type SafetyFinding = { category: "secret" | "pii"; kind: string; severity: "medium" | "high" | "critical"; start: number; end: number; masked_match: string }
type SafetyScan = { safe: boolean; risk_level: "none" | "medium" | "high" | "critical"; findings: SafetyFinding[]; redacted_content: string }
type DraftCase = { id: string; name: string; input: string; expected: string }

function errorText(error: unknown) { return error instanceof Error ? error.message : "The API could not complete this request." }
function formatTokens(value: number) { return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value) }

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, options)
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(payload?.detail ?? "Request failed.")
  }
  return response.json() as Promise<T>
}

export function QualityWorkspace({ view, providers, onUsePrompt, onRefresh }: { view: QualityView; providers: Provider[]; onUsePrompt: (content: string) => void; onRefresh: () => Promise<void> }) {
  const [notice, setNotice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [suites, setSuites] = useState<Suite[]>([])
  const [selectedSuite, setSelectedSuite] = useState<Suite | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [template, setTemplate] = useState("Review this request and provide a safe, practical answer:\n\n{{input}}")
  const [systemPrompt, setSystemPrompt] = useState("You are a careful production assistant. Be direct and concrete.")
  const [draftCases, setDraftCases] = useState<DraftCase[]>([{ id: "case-1", name: "Baseline", input: "How should I roll out a Python API safely?", expected: "baseline" }])
  const [runProvider, setRunProvider] = useState("openai")
  const [runMode, setRunMode] = useState<RunMode>("demo")
  const [scanContent, setScanContent] = useState("")
  const [scan, setScan] = useState<SafetyScan | null>(null)

  const provider = useMemo(() => providers.find((item) => item.id === runProvider) ?? providers[0], [providers, runProvider])

  async function loadSuites() {
    const result = await requestJson<Suite[]>("/api/test-suites")
    setSuites(result)
  }

  useEffect(() => {
    if (view !== "Test suites") return
    const initialLoad = window.setTimeout(() => {
      void loadSuites().catch((error) => setNotice(errorText(error)))
    }, 0)
    return () => window.clearTimeout(initialLoad)
  }, [view])

  async function selectSuite(id: string) {
    try {
      const suite = await requestJson<Suite>(`/api/test-suites/${id}`)
      setSelectedSuite(suite)
      setNotice(null)
    } catch (error) { setNotice(errorText(error)) }
  }

  function newSuite() {
    setSelectedSuite(null)
    setTitle("")
    setDescription("")
    setTemplate("Review this request and provide a safe, practical answer:\n\n{{input}}")
    setSystemPrompt("You are a careful production assistant. Be direct and concrete.")
    setDraftCases([{ id: `case-${Date.now()}`, name: "Baseline", input: "How should I roll out a Python API safely?", expected: "baseline" }])
    setNotice(null)
  }

  async function createSuite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setNotice(null)
    try {
      const suite = await requestJson<Suite>("/api/test-suites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description, prompt_template: template, system_prompt: systemPrompt, cases: draftCases.map((item) => ({ name: item.name, input: item.input, assertions: [{ type: "contains", value: item.expected }] })) }) })
      setSuites((current) => [suite, ...current])
      setSelectedSuite(suite)
      setNotice("Test suite saved. Run it in Demo mode or against a configured live provider.")
    } catch (error) { setNotice(errorText(error)) } finally { setIsLoading(false) }
  }

  async function runSuite() {
    if (!selectedSuite || !provider) return
    setIsLoading(true)
    setNotice(null)
    try {
      const run = await requestJson<SuiteRun>(`/api/test-suites/${selectedSuite.id}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: provider.id, model: provider.model, mode: runMode }) })
      const updated = { ...selectedSuite, runs: [run, ...selectedSuite.runs] }
      setSelectedSuite(updated)
      setSuites((current) => current.map((suite) => suite.id === updated.id ? updated : suite))
      await onRefresh()
    } catch (error) { setNotice(errorText(error)) } finally { setIsLoading(false) }
  }

  async function runSafetyScan() {
    setIsLoading(true)
    setNotice(null)
    try {
      setScan(await requestJson<SafetyScan>("/api/safety/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: scanContent }) }))
    } catch (error) { setNotice(errorText(error)) } finally { setIsLoading(false) }
  }

  if (view === "Safety checks") return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-4xl"><div className="flex items-center gap-2"><ShieldCheck className="size-4" /><h1 className="text-lg font-semibold tracking-tight">Safety checks</h1></div><p className="mt-1 text-xs text-muted-foreground">Scan draft prompt content locally for likely credentials and personal data before routing it to a provider. Content is never stored by the scan API.</p>{notice && <div className="mt-4 border bg-muted px-3 py-2 text-xs">{notice}</div>}<div className="mt-6 grid gap-6 lg:grid-cols-2"><Card className="border"><CardHeader className="border-b"><CardTitle>Prompt preflight</CardTitle><CardDescription>Patterns cover common API keys, private key headers, credential assignments, email addresses, and phone numbers.</CardDescription></CardHeader><CardContent className="space-y-3 pt-4"><Textarea value={scanContent} onChange={(event) => { setScanContent(event.target.value); setScan(null) }} placeholder="Paste draft prompt text to scan locally…" className="h-72 resize-y font-mono text-xs" /><Button onPress={() => void runSafetyScan()} isDisabled={isLoading || !scanContent.trim()}><ShieldCheck /> {isLoading ? "Scanning…" : "Scan content"}</Button></CardContent></Card><div className="space-y-4">{scan ? <><Card className={`border ${scan.safe ? "border-emerald-600/40" : "border-destructive/50"}`}><CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><CardTitle>{scan.safe ? "No likely sensitive content" : `${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"}`}</CardTitle><Badge variant={scan.safe ? "secondary" : scan.risk_level === "critical" ? "destructive" : "outline"}>{scan.risk_level} risk</Badge></div><CardDescription>{scan.safe ? "The local pattern scan found no credential or PII matches." : "Review the redacted preview before sending this content externally."}</CardDescription></CardHeader><CardContent className="space-y-2 pt-4">{scan.findings.map((finding, index) => <div key={`${finding.kind}-${index}`} className="flex items-center justify-between border-l-2 border-destructive pl-2 text-xs"><span><strong>{finding.kind}</strong> · {finding.category}</span><Badge variant="outline">{finding.severity}</Badge></div>)}</CardContent></Card><Card className="border"><CardHeader className="border-b"><div className="flex items-center justify-between gap-2"><CardTitle>Redacted preview</CardTitle><Button onPress={() => onUsePrompt(scan.redacted_content)} size="sm" variant="outline">Use redacted prompt</Button></div></CardHeader><CardContent><pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">{scan.redacted_content}</pre></CardContent></Card></> : <Card className="border"><CardContent className="py-16 text-center text-xs text-muted-foreground">Scan a draft to receive a redacted preview. This safety check is local-only and is not a replacement for data-classification policy.</CardContent></Card>}</div></div></div></div>

  return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><ListChecks className="size-4" /><h1 className="text-lg font-semibold tracking-tight">Test suites</h1></div><p className="mt-1 text-xs text-muted-foreground">Create regression cases once, batch-run them against a model, and use pass rate as a release-quality gate.</p></div><Button onPress={newSuite} variant="outline" size="sm"><Plus /> New suite</Button></div>{notice && <div className="mt-4 border bg-muted px-3 py-2 text-xs">{notice}</div>}<div className="mt-6 grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]"><aside><div className="space-y-2">{suites.length ? suites.map((suite) => <button key={suite.id} onClick={() => void selectSuite(suite.id)} className={`w-full border p-3 text-left ${selectedSuite?.id === suite.id ? "border-foreground bg-muted" : "hover:bg-muted/50"}`}><p className="truncate text-xs font-medium">{suite.title}</p><p className="mt-1 text-[10px] text-muted-foreground">{suite.cases.length} cases · {suite.runs[0] ? `${suite.runs[0].passed_cases}/${suite.runs[0].total_cases} latest` : "not run"}</p></button>) : <p className="border border-dashed p-3 text-xs text-muted-foreground">Create a suite to establish a repeatable quality gate.</p>}</div></aside><div>{selectedSuite ? <div className="space-y-5"><Card className="border"><CardHeader className="border-b"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>{selectedSuite.title}</CardTitle><CardDescription>{selectedSuite.description || "No description provided."}</CardDescription></div><Badge variant="outline">{selectedSuite.cases.length} cases</Badge></div></CardHeader><CardContent className="space-y-3 pt-4"><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium">Provider<select value={runProvider} onChange={(event) => setRunProvider(event.target.value)} className="mt-2 h-9 w-full border bg-background px-2 text-xs">{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-medium">Mode<select value={runMode} onChange={(event) => setRunMode(event.target.value as RunMode)} className="mt-2 h-9 w-full border bg-background px-2 text-xs"><option value="demo">Demo</option><option value="live">Live</option></select></label><div className="flex items-end"><Button onPress={() => void runSuite()} isDisabled={isLoading || !provider} className="w-full"><Play /> {isLoading ? "Running…" : "Run suite"}</Button></div></div><p className="text-[11px] text-muted-foreground">Prompt template: <code>{"{{input}}"}</code> is replaced separately for every case.</p></CardContent></Card><div className="grid gap-3 lg:grid-cols-2">{selectedSuite.cases.map((testCase) => <Card key={testCase.id} size="sm" className="border"><CardContent><p className="text-xs font-medium">{testCase.name}</p><p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{testCase.input}</p><p className="mt-2 text-[10px] text-muted-foreground">Expects {testCase.assertions.map((assertion) => `${assertion.type}: ${assertion.value}`).join(", ")}</p></CardContent></Card>)}</div>{selectedSuite.runs.length > 0 && <Card className="border"><CardHeader className="border-b"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Latest batch result</CardTitle><Badge variant={selectedSuite.runs[0].failed_cases ? "destructive" : "secondary"}>{selectedSuite.runs[0].passed_cases}/{selectedSuite.runs[0].total_cases} passed</Badge></div><CardDescription>{selectedSuite.runs[0].provider} / {selectedSuite.runs[0].model} · {selectedSuite.runs[0].mode}</CardDescription></CardHeader><CardContent className="grid gap-3 pt-4 lg:grid-cols-2">{selectedSuite.runs[0].case_runs.map((caseRun) => <article key={caseRun.id} className="border p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{caseRun.case_name}</p>{caseRun.passed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}</div><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">{caseRun.error ?? caseRun.response}</p><div className="mt-2 flex gap-2 text-[10px] text-muted-foreground"><span>{(caseRun.latency_ms / 1000).toFixed(1)}s</span><span>{formatTokens(caseRun.prompt_tokens + caseRun.completion_tokens)} tokens</span></div>{caseRun.outcomes.map((outcome, index) => <p key={index} className={`mt-2 text-[10px] ${outcome.passed ? "text-emerald-700" : "text-destructive"}`}>{outcome.detail}</p>)}</article>)}</CardContent></Card>}</div> : <form onSubmit={createSuite}><Card className="border"><CardHeader className="border-b"><CardTitle>New test suite</CardTitle><CardDescription>Use the same prompt template for several representative inputs. Each case is a deterministic contains assertion; the API also supports absence, exact match, JSON, and length assertions.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Suite name<Input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2" required /></label><label className="text-xs font-medium">Description<Input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2" /></label></div><label className="block text-xs font-medium">Prompt template<Textarea value={template} onChange={(event) => setTemplate(event.target.value)} className="mt-2 h-24 resize-y font-mono text-xs" required /></label><label className="block text-xs font-medium">System instruction<Textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} className="mt-2 h-20 resize-y font-mono text-xs" /></label><div><div className="flex items-center justify-between"><p className="text-xs font-medium">Test cases</p><Button type="button" onPress={() => setDraftCases((current) => [...current, { id: `case-${Date.now()}`, name: "", input: "", expected: "" }])} variant="outline" size="sm"><Plus /> Case</Button></div><div className="mt-3 space-y-3">{draftCases.map((testCase, index) => <div key={testCase.id} className="border p-3"><div className="flex justify-between gap-2"><label className="flex-1 text-xs font-medium">Case name<Input value={testCase.name} onChange={(event) => setDraftCases((current) => current.map((item) => item.id === testCase.id ? { ...item, name: event.target.value } : item))} className="mt-2" required /></label>{draftCases.length > 1 && <Button type="button" onPress={() => setDraftCases((current) => current.filter((item) => item.id !== testCase.id))} variant="ghost" size="icon-sm" aria-label={`Remove case ${index + 1}`}><Trash2 /></Button>}</div><label className="mt-2 block text-xs font-medium">Input<Textarea value={testCase.input} onChange={(event) => setDraftCases((current) => current.map((item) => item.id === testCase.id ? { ...item, input: event.target.value } : item))} className="mt-2 h-16 resize-y" required /></label><label className="mt-2 block text-xs font-medium">Response must contain<Input value={testCase.expected} onChange={(event) => setDraftCases((current) => current.map((item) => item.id === testCase.id ? { ...item, expected: event.target.value } : item))} className="mt-2" required /></label></div>)}</div></div><Button type="submit" isDisabled={isLoading}><Save /> {isLoading ? "Saving…" : "Save suite"}</Button></CardContent></Card></form>}</div></div></div></div>
}
