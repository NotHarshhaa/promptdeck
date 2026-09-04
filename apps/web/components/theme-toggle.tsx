"use client"

import { useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip"

function subscribe() {
  return () => {}
}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )

  if (!mounted) {
    return (
      <Button variant="outline" size="icon-sm" aria-label="Toggle theme" isDisabled>
        <Sun className="size-3.5" />
      </Button>
    )
  }

  const isDark = resolvedTheme === "dark"

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark")
  }

  return (
    <TooltipTrigger>
      <Button
        variant="outline"
        size="icon-sm"
        onPress={toggleTheme}
        aria-label={`Current theme: ${theme}. Click to switch to ${isDark ? "light" : "dark"} mode (Hotkey: D)`}
      >
        {isDark ? (
          <Sun className="size-3.5 text-amber-400 transition-transform duration-200 hover:rotate-45" />
        ) : (
          <Moon className="size-3.5 text-slate-700 transition-transform duration-200 hover:-rotate-12 dark:text-slate-300" />
        )}
      </Button>
      <Tooltip>
        Switch to {isDark ? "light" : "dark"} mode (Press D)
      </Tooltip>
    </TooltipTrigger>
  )
}
