import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import {
  setActivityTerminalPortals,
  type ActivityTerminalPortalTarget
} from './activity-terminal-portal'
import {
  reconcileActivityPortalThreads,
  resolveActivityPortalSwap
} from './activity-portal-thread-reconciliation'
import { useAgentPaneThreads } from './use-agent-pane-threads'
import { createActivityThreadActions, hasActivityThreadWorkspace } from './activity-thread-actions'
import { ActivityThreadDetailPane } from './activity-thread-detail-pane'
import { AgentBoardCardList } from './agent-board-card-list'
import {
  agentBoardSectionId,
  buildAgentBoardSections,
  type AgentBoardHeldSection
} from './activity-thread-grouping'
import { activityThreadStatusId } from './activity-thread-presentation'
import {
  otherActivityTerminalSlot,
  useActivityTerminalLoadingLabel,
  useActivityTerminalPortalStatus
} from './activity-terminal-portal-status'
import type { ActivityTerminalPortalSlotId, AgentPaneThread } from './activity-thread-types'
import { focusRuntimeTerminalSurface } from '@/runtime/mounted-terminal-tab-registry'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'

export * from './activity-prototype-page-exports'

export default function ActivityPrototypePage(): React.JSX.Element {
  // Auto-acknowledge each selected thread turn once.
  const autoAcknowledgedTurnRef = useRef<string | null>(null)
  const showChildAgents = useAppStore((s) => s.agentsShowChildAgents)
  const [selectedPaneKey, setSelectedPaneKey] = useState<string | null>(null)
  const [heldSection, setHeldSection] = useState<AgentBoardHeldSection | null>(null)
  const [displayedPaneKey, setDisplayedPaneKey] = useState<string | null>(null)
  const [activePortalSlotId, setActivePortalSlotId] =
    useState<ActivityTerminalPortalSlotId>('primary')
  const [primaryPortalTargetEl, setPrimaryPortalTargetEl] = useState<HTMLElement | null>(null)
  const [secondaryPortalTargetEl, setSecondaryPortalTargetEl] = useState<HTMLElement | null>(null)
  // 420px keeps a card's reason readable while the terminal keeps most of the width.
  const [threadListWidth, setThreadListWidth] = useState(420)
  const {
    containerRef: threadListRef,
    isResizing: isThreadListResizing,
    onResizeStart
  } = useSidebarResize<HTMLDivElement>({
    isOpen: true,
    width: threadListWidth,
    minWidth: 320,
    maxWidth: 720,
    deltaSign: 1,
    setWidth: setThreadListWidth
  })

  const { storeData, allThreads, selectedPaneKeyIsLive, effectiveSelectedPaneKey, visibleThreads } =
    useAgentPaneThreads({
      query: '',
      readFilter: 'all',
      groupBy: 'none',
      selectedPaneKey,
      showChildAgents
    })
  if (!selectedPaneKeyIsLive) {
    // Clear vanished pane selection before detail/portal rendering targets it.
    setSelectedPaneKey(null)
  }

  const selectedThread = effectiveSelectedPaneKey
    ? (allThreads.find((thread) => thread.paneKey === effectiveSelectedPaneKey) ?? null)
    : null
  const selectedTabId = selectedThread?.tab.id ?? null
  const selectedWorktreeAvailable = selectedThread
    ? hasActivityThreadWorkspace(selectedThread, storeData)
    : false
  // Repo-less terminal buckets can have activity rows but no workspace Terminal portal.
  const selectedHasLiveTab =
    selectedThread && selectedTabId && selectedWorktreeAvailable
      ? (storeData.tabsByWorktree[selectedThread.worktree.id] ?? []).some(
          (tab) => tab.id === selectedTabId
        )
      : false
  const displayedThread = displayedPaneKey
    ? (allThreads.find((thread) => thread.paneKey === displayedPaneKey) ?? null)
    : null
  const displayedTabId = displayedThread?.tab.id ?? null
  const displayedWorktreeAvailable = displayedThread
    ? hasActivityThreadWorkspace(displayedThread, storeData)
    : false
  const displayedHasLiveTab =
    displayedThread && displayedTabId && displayedWorktreeAvailable
      ? (storeData.tabsByWorktree[displayedThread.worktree.id] ?? []).some(
          (tab) => tab.id === displayedTabId
        )
      : false
  const { visibleThread, stagedThread } = reconcileActivityPortalThreads({
    selectedThread,
    displayedThread,
    selectedHasLiveTab: Boolean(selectedHasLiveTab),
    displayedHasLiveTab: Boolean(displayedHasLiveTab)
  })
  const inactivePortalSlotId = otherActivityTerminalSlot(activePortalSlotId)
  const portalTargetBySlot = {
    primary: primaryPortalTargetEl,
    secondary: secondaryPortalTargetEl
  } satisfies Record<ActivityTerminalPortalSlotId, HTMLElement | null>
  const activePortalTargetEl = portalTargetBySlot[activePortalSlotId]
  const inactivePortalTargetEl = portalTargetBySlot[inactivePortalSlotId]
  const visiblePortalStatus = useActivityTerminalPortalStatus(
    activePortalTargetEl,
    visibleThread?.paneKey ?? null,
    visibleThread?.migrationUnsupportedPtyId !== undefined
  )
  const stagedPortalStatus = useActivityTerminalPortalStatus(
    inactivePortalTargetEl,
    stagedThread?.paneKey ?? null,
    stagedThread?.migrationUnsupportedPtyId !== undefined
  )
  const visiblePortalReady = visiblePortalStatus === 'ready'
  const visiblePortalUnavailable = visiblePortalStatus === 'unavailable'
  const stagedPortalReady = stagedPortalStatus === 'ready'
  const stagedPortalUnavailable = stagedPortalStatus === 'unavailable'
  const showTerminalLoadingLabel = useActivityTerminalLoadingLabel(
    Boolean(visibleThread && !stagedThread && !visiblePortalReady)
  )

  const setPrimaryPortalTarget = useCallback((target: HTMLElement | null): void => {
    setPrimaryPortalTargetEl(target)
  }, [])

  const setSecondaryPortalTarget = useCallback((target: HTMLElement | null): void => {
    setSecondaryPortalTargetEl(target)
  }, [])

  // Anchor portals to selected thread IDs to avoid stale-last-tab flashes. Memoize descriptors for subscriber bailouts and stage the next terminal at the same size.
  const portalDescriptors = useMemo(() => {
    const descriptors: ActivityTerminalPortalTarget[] = []
    if (visibleThread && activePortalTargetEl) {
      descriptors.push({
        slotId: activePortalSlotId,
        requestToken: `${activePortalSlotId}:${visibleThread.paneKey}`,
        target: activePortalTargetEl,
        worktreeId: visibleThread.worktree.id,
        tabId: visibleThread.tab.id,
        paneKey: visibleThread.paneKey,
        forceUnavailable: visibleThread.migrationUnsupportedPtyId !== undefined,
        active: true
      })
    }
    if (stagedThread && inactivePortalTargetEl) {
      descriptors.push({
        slotId: inactivePortalSlotId,
        requestToken: `${inactivePortalSlotId}:${stagedThread.paneKey}`,
        target: inactivePortalTargetEl,
        worktreeId: stagedThread.worktree.id,
        tabId: stagedThread.tab.id,
        paneKey: stagedThread.paneKey,
        forceUnavailable: stagedThread.migrationUnsupportedPtyId !== undefined,
        active: false
      })
    }
    return descriptors
  }, [
    activePortalSlotId,
    activePortalTargetEl,
    inactivePortalSlotId,
    inactivePortalTargetEl,
    stagedThread,
    visibleThread
  ])

  // A staged swap selects its displayed thread, preventing self-repetition.
  useLayoutEffect(() => {
    const swap = resolveActivityPortalSwap({
      selectedThread,
      selectedHasLiveTab: Boolean(selectedHasLiveTab),
      visibleThread,
      stagedThread,
      visiblePortalReady,
      stagedPortalReady,
      stagedPortalUnavailable
    })
    if (swap?.kind === 'clear') {
      setDisplayedPaneKey(null)
      return
    }
    if (swap?.kind === 'swap-staged') {
      // Swap stale selections to unavailable state rather than showing the previous pane under a new row.
      setActivePortalSlotId(inactivePortalSlotId)
      setDisplayedPaneKey(swap.paneKey)
      return
    }
    if (swap?.kind === 'settle-visible') {
      setDisplayedPaneKey(swap.paneKey)
    }
  }, [
    inactivePortalSlotId,
    selectedHasLiveTab,
    selectedThread,
    stagedPortalUnavailable,
    stagedPortalReady,
    stagedThread,
    visiblePortalReady,
    visibleThread
  ])

  // Publish before paint to prevent stale-target flashes. Clear only on unmount; per-change null transitions flash the workspace pane.
  useLayoutEffect(() => {
    setActivityTerminalPortals(portalDescriptors)
  }, [portalDescriptors])

  const setActivityPageRef = useCallback((node: HTMLDivElement | null): void => {
    if (!node) {
      // Clear portals only on unmount to avoid flashing behind changed descriptors.
      setActivityTerminalPortals([])
    }
  }, [])

  const { jumpToWorkspace, prepareThreadTerminal } = useMemo(
    () =>
      createActivityThreadActions({
        getMarkAllReadThreads: () => [],
        acknowledgeAgents: storeData.acknowledgeAgents,
        unacknowledgeAgents: storeData.unacknowledgeAgents,
        setSelectedPaneKey
      }),
    [storeData.acknowledgeAgents, storeData.unacknowledgeAgents]
  )

  const sections = useMemo(
    () => buildAgentBoardSections(visibleThreads, heldSection),
    [visibleThreads, heldSection]
  )

  const selectCard = useCallback(
    (thread: AgentPaneThread): void => {
      prepareThreadTerminal(thread)
      setHeldSection({
        paneKey: thread.paneKey,
        statusId: activityThreadStatusId(thread),
        sectionId: agentBoardSectionId(thread)
      })
    },
    [prepareThreadTerminal]
  )

  // Read the latest portal state from frame callbacks without re-binding card handlers.
  const portalFocusStateRef = useRef({
    paneKey: null as string | null,
    target: null as HTMLElement | null,
    ready: false
  })
  portalFocusStateRef.current = {
    paneKey: visibleThread?.paneKey ?? null,
    target: activePortalTargetEl,
    ready: visiblePortalReady
  }

  const openCardTerminal = useCallback(
    (thread: AgentPaneThread): void => {
      selectCard(thread)
      const parsed = parsePaneKey(thread.paneKey)
      const leafId = parsed && parsed.tabId === thread.tab.id ? parsed.leafId : null
      // A newly selected terminal moves into the portal over a few frames; focus it once it lands there.
      let framesLeft = 30
      const focusWhenPortaled = (): void => {
        const { paneKey, target, ready } = portalFocusStateRef.current
        if (paneKey === thread.paneKey && ready && target) {
          focusRuntimeTerminalSurface(thread.tab.id, leafId, thread.worktree.id)
          if (!target.contains(document.activeElement)) {
            target.querySelector<HTMLElement>('textarea.xterm-helper-textarea')?.focus()
          }
          return
        }
        if (framesLeft-- > 0) {
          requestAnimationFrame(focusWhenPortaled)
        }
      }
      focusWhenPortaled()
    },
    [selectCard]
  )

  useEffect(() => {
    if (
      !selectedThread ||
      !selectedThread.unread ||
      stagedThread ||
      selectedThread.paneKey !== effectiveSelectedPaneKey
    ) {
      return
    }
    // Remote turn clocks may exceed local acknowledgement time and trigger endless store rewrites (React #185). Auto-read once per turn, never retry by unread status.
    const autoAcknowledgeKey = `${selectedThread.paneKey}:${selectedThread.latestTimestamp}`
    if (autoAcknowledgedTurnRef.current === autoAcknowledgeKey) {
      return
    }
    const selectedThreadHasDetailOnlyView =
      !selectedHasLiveTab || selectedThread.migrationUnsupportedPtyId !== undefined
    const selectedThreadIsVisibleTerminal =
      visibleThread?.paneKey === effectiveSelectedPaneKey && visiblePortalReady
    if (selectedThreadHasDetailOnlyView || selectedThreadIsVisibleTerminal) {
      autoAcknowledgedTurnRef.current = autoAcknowledgeKey
      storeData.acknowledgeAgents([selectedThread.paneKey])
    }
  }, [
    selectedHasLiveTab,
    effectiveSelectedPaneKey,
    selectedThread,
    stagedThread,
    storeData,
    visiblePortalReady,
    visibleThread
  ])

  // Page content reaches window edges; titlebars supply top spacing.
  return (
    <div ref={setActivityPageRef} className="flex h-full min-h-0 flex-col bg-background pb-3">
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <AgentBoardCardList
          sections={sections}
          selectedPaneKey={selectedThread?.paneKey ?? null}
          onSelect={selectCard}
          onOpenTerminal={openCardTerminal}
          listRef={threadListRef}
          width={threadListWidth}
          isResizing={isThreadListResizing}
          onResizeStart={onResizeStart}
        />
        <ActivityThreadDetailPane
          selectedThread={selectedThread}
          selectedHasLiveTab={Boolean(selectedHasLiveTab)}
          selectedWorktreeAvailable={selectedWorktreeAvailable}
          visibleThread={visibleThread}
          stagedThread={stagedThread}
          activePortalSlotId={activePortalSlotId}
          setPrimaryPortalTarget={setPrimaryPortalTarget}
          setSecondaryPortalTarget={setSecondaryPortalTarget}
          visiblePortalReady={visiblePortalReady}
          visiblePortalUnavailable={visiblePortalUnavailable}
          showTerminalLoadingLabel={showTerminalLoadingLabel}
          visibleThreadCount={visibleThreads.length}
          onOpenWorkspace={selectedThread ? () => jumpToWorkspace(selectedThread) : undefined}
        />
      </main>
    </div>
  )
}
