"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip"

interface MarkdownMessageProps {
  content: string
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="my-2.5 overflow-hidden rounded-none border border-border bg-muted/60 dark:bg-black/40">
      <div className="flex items-center justify-between border-b border-border bg-muted/90 px-3 py-1 text-[11px] font-mono text-muted-foreground">
        <span>{language || "text"}</span>
        <TooltipTrigger>
          <Button
            variant="ghost"
            size="icon-xs"
            onPress={copyCode}
            aria-label="Copy code block"
          >
            {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
          </Button>
          <Tooltip>{copied ? "Copied" : "Copy code"}</Tooltip>
        </TooltipTrigger>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  // Parse code blocks vs regular markdown text
  const parts: React.ReactNode[] = []
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textChunk = content.slice(lastIndex, match.index)
      parts.push(renderTextChunk(textChunk, `text-${lastIndex}`))
    }

    const language = match[1] || ""
    const code = match[2].trimEnd()
    parts.push(<CodeBlock key={`code-${match.index}`} code={code} language={language} />)

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push(renderTextChunk(content.slice(lastIndex), `text-${lastIndex}`))
  }

  return <div className="space-y-1 text-xs leading-relaxed">{parts}</div>
}

function renderTextChunk(text: string, keyPrefix: string) {
  const lines = text.split("\n")
  return (
    <div key={keyPrefix} className="space-y-1">
      {lines.map((line, lineIndex) => {
        // Headers
        if (line.startsWith("### ")) {
          return (
            <h4 key={lineIndex} className="pt-2 text-xs font-semibold text-foreground">
              {renderInlineStyles(line.slice(4))}
            </h4>
          )
        }
        if (line.startsWith("## ")) {
          return (
            <h3 key={lineIndex} className="pt-2 text-sm font-semibold text-foreground">
              {renderInlineStyles(line.slice(3))}
            </h3>
          )
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={lineIndex} className="pt-2.5 text-sm font-bold text-foreground">
              {renderInlineStyles(line.slice(2))}
            </h2>
          )
        }

        // Bullet lists
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={lineIndex} className="flex items-start gap-2 pl-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/60" />
              <span>{renderInlineStyles(line.slice(2))}</span>
            </div>
          )
        }

        // Empty line
        if (!line.trim()) {
          return <div key={lineIndex} className="h-2" />
        }

        return (
          <p key={lineIndex} className="leading-6">
            {renderInlineStyles(line)}
          </p>
        )
      })}
    </div>
  )
}

function renderInlineStyles(line: string): React.ReactNode[] {
  // Matches inline code `code`, bold **bold**, or italic *italic*
  const elements: React.ReactNode[] = []
  const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      elements.push(line.slice(lastIndex, match.index))
    }

    const token = match[0]
    if (token.startsWith("`") && token.endsWith("`")) {
      elements.push(
        <code
          key={match.index}
          className="rounded-none border border-border bg-muted/60 px-1 py-0.5 font-mono text-[11px] text-foreground dark:bg-muted/40"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith("**") && token.endsWith("**")) {
      elements.push(
        <strong key={match.index} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith("*") && token.endsWith("*")) {
      elements.push(
        <em key={match.index} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < line.length) {
    elements.push(line.slice(lastIndex))
  }

  return elements.length > 0 ? elements : [line]
}
