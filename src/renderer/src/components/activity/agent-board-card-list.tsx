import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/app-keyboard-router'
import { hasVisibleOverlay } from '@/lib/visible-overlay'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import {
  ActivityStatusGroupHeader,
  EventRepoBadge,
  EventTime,
  ThreadAgentStateIndicator
} from './activity-thread-controls'
import { ActivityThreadListResizeHandle } from './activity-thread-list-resize-handle'
import { agentBoardWaitHeadline, agentBoardWaitReason } from './activity-thread-presentation'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import type { AgentBoardSection, AgentBoardSectionId } from './activity-thread-grouping'
import type { AgentPaneThread } from './activity-thread-types'

function sectionLabel(id: AgentBoardSectionId): string {
  switch (id) {
    case 'attention':
      return translate('agentBoard.section.attention', 'Waiting on you')
    case 'working':
      return translate('agentBoard.section.working', 'Working')
    case 'other':
      return translate('agentBoard.section.other', 'Everything else')
  }
}

const AgentBoardCard = React.memo(function AgentBoardCard({
  thread,
  selected,
  onSelect,
  onOpenTerminal
}: {
  thread: AgentPaneThread
  selected: boolean
  onSelect: (thread: AgentPaneThread) => void
  onOpenTerminal: (thread: AgentPaneThread) => void
}): React.JSX.Element {
  // Memoized cards must re-render their translated headline on a language switch.
  useUiLanguageRevision()
  const reason = agentBoardWaitReason(thread)
  const title = thread.paneTitle.trim() || getActivityThreadWorkspaceTitle(thread.worktree)
  return (
    <div
      role="option"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      data-agent-board-pane-key={thread.paneKey}
      data-current={selected ? 'true' : undefined}
      onClick={() => onSelect(thread)}
      onDoubleClick={() => onOpenTerminal(thread)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault()
          onOpenTerminal(thread)
        }
      }}
      className={cn(
        'flex cursor-default flex-col gap-1 rounded-lg border border-border px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected && 'bg-accent'
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <ThreadAgentStateIndicator thread={thread} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {agentBoardWaitHeadline(thread)}
        </span>
        <EventTime timestamp={thread.latestTimestamp} compact className="shrink-0" />
      </div>
      <div className="line-clamp-2 break-words text-[13px] font-semibold leading-snug">{title}</div>
      {reason ? (
        <p className="line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">
          {reason}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center gap-1.5 pt-0.5">
        <EventRepoBadge repo={thread.repo} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {getActivityThreadWorkspaceTitle(thread.worktree)}
        </span>
        <AgentTypeIcon agentType={thread.agentType} size={14} />
      </div>
    </div>
  )
})

export function AgentBoardCardList({
  sections,
  selectedPaneKey,
  onSelect,
  onOpenTerminal,
  listRef,
  width,
  isResizing,
  onResizeStart
}: {
  sections: AgentBoardSection[]
  selectedPaneKey: string | null
  onSelect: (thread: AgentPaneThread) => void
  onOpenTerminal: (thread: AgentPaneThread) => void
  listRef: React.RefObject<HTMLDivElement | null>
  width: number
  isResizing: boolean
  onResizeStart: React.MouseEventHandler<HTMLDivElement>
}): React.JSX.Element {
  // Settled rows are rarely actionable, so they start folded away.
  const [collapsed, setCollapsed] = useState<Record<AgentBoardSectionId, boolean>>({
    attention: false,
    working: false,
    other: true
  })
  const keybindings = useAppStore((s) => s.keybindings)
  // Activating a cold workspace autofocuses its terminal; keep keyboard browsing on the card until the user opens it.
  const heldCardFocusRef = useRef<{ card: HTMLElement; until: number } | null>(null)
  useEffect(() => {
    const release = (): void => {
      heldCardFocusRef.current = null
    }
    const restoreCardFocus = (event: FocusEvent): void => {
      const held = heldCardFocusRef.current
      if (!held || Date.now() > held.until || !held.card.isConnected) {
        heldCardFocusRef.current = null
        return
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.classList.contains('xterm-helper-textarea')
      ) {
        held.card.focus({ preventScroll: true })
      }
    }
    window.addEventListener('focusin', restoreCardFocus, { capture: true })
    window.addEventListener('pointerdown', release, { capture: true })
    return () => {
      window.removeEventListener('focusin', restoreCardFocus, { capture: true })
      window.removeEventListener('pointerdown', release, { capture: true })
    }
  }, [])

  const openTerminal = useCallback(
    (thread: AgentPaneThread): void => {
      heldCardFocusRef.current = null
      onOpenTerminal(thread)
    },
    [onOpenTerminal]
  )

  const moveSelection = useCallback(
    (direction: 'up' | 'down'): void => {
      const order = sections.flatMap((section) => (collapsed[section.id] ? [] : section.threads))
      if (order.length === 0) {
        return
      }
      const index = order.findIndex((thread) => thread.paneKey === selectedPaneKey)
      const nextIndex =
        index === -1
          ? direction === 'down'
            ? 0
            : order.length - 1
          : Math.min(order.length - 1, Math.max(0, index + (direction === 'down' ? 1 : -1)))
      const next = order[nextIndex]
      onSelect(next)
      // Move focus with the selection so Enter opens the card the user just landed on.
      const card = listRef.current?.querySelector<HTMLElement>(
        `[data-agent-board-pane-key="${CSS.escape(next.paneKey)}"]`
      )
      if (card) {
        heldCardFocusRef.current = { card, until: Date.now() + 2000 }
        card.focus({ preventScroll: true })
        card.scrollIntoView({ block: 'nearest' })
      }
    },
    [collapsed, listRef, onSelect, sections, selectedPaneKey]
  )

  // Reuse the previous/next workspace chords: the board replaces the sidebar list they walk, and they work from inside the terminal.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || hasVisibleOverlay()) {
        return
      }
      const platform = getShortcutPlatform()
      const direction = keybindingMatchesAction('worktree.navigateUp', event, platform, keybindings)
        ? 'up'
        : keybindingMatchesAction('worktree.navigateDown', event, platform, keybindings)
          ? 'down'
          : null
      if (!direction) {
        return
      }
      event.preventDefault()
      // Keep the chord out of a focused xterm so it never reaches the PTY.
      event.stopPropagation()
      moveSelection(direction)
    }
    addAppKeyListener('keydown', handleKeyDown)
    return () => removeAppKeyListener('keydown', handleKeyDown)
  }, [keybindings, moveSelection])
  return (
    <aside
      ref={listRef}
      className="relative flex min-h-0 shrink-0 flex-col border-r border-border"
      style={{ width }}
    >
      <div
        role="listbox"
        // Page content, not a popup: overlay checks would otherwise block the board's own shortcuts.
        data-focus-behavior="page"
        aria-label={translate('agentBoard.title', 'Agent board')}
        className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pt-2 pb-3"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
            return
          }
          if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
            return
          }
          event.preventDefault()
          moveSelection(event.key === 'ArrowUp' ? 'up' : 'down')
        }}
      >
        {sections.map((section) => {
          const isCollapsed = collapsed[section.id]
          return (
            <section key={section.id} className="flex flex-col gap-1.5 pb-2">
              <ActivityStatusGroupHeader
                group={{
                  key: section.id,
                  label: sectionLabel(section.id),
                  threads: section.threads
                }}
                collapsed={isCollapsed}
                onToggle={() =>
                  setCollapsed((previous) => ({ ...previous, [section.id]: !previous[section.id] }))
                }
              />
              {isCollapsed ? null : section.threads.length === 0 ? (
                <div className="px-2 pb-1 text-xs text-muted-foreground">
                  {section.id === 'attention'
                    ? translate('agentBoard.empty.attention', 'No agent is waiting on you.')
                    : translate('agentBoard.empty.section', 'None')}
                </div>
              ) : (
                section.threads.map((thread) => (
                  <AgentBoardCard
                    key={thread.paneKey}
                    thread={thread}
                    selected={thread.paneKey === selectedPaneKey}
                    onSelect={onSelect}
                    onOpenTerminal={openTerminal}
                  />
                ))
              )}
            </section>
          )
        })}
      </div>
      <ActivityThreadListResizeHandle isResizing={isResizing} onResizeStart={onResizeStart} />
    </aside>
  )
}
