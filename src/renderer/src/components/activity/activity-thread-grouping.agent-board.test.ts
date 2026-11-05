import { describe, expect, it } from 'vitest'

import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import { buildAgentBoardSections } from './activity-thread-grouping'
import type { ActivityLiveAgentState, AgentPaneThread } from './activity-thread-types'
import { makeTab, makeWorktree } from './ActivityPrototypePage-test-fixtures'

function makeThread(
  paneKey: string,
  state: ActivityLiveAgentState | 'done',
  latestTimestamp: number,
  unread = false
): AgentPaneThread {
  return {
    paneKey,
    tab: makeTab(),
    worktree: makeWorktree(),
    repo: null,
    currentAgentState: state === 'done' ? null : state,
    currentAgentEntry: null,
    paneEntry: state === 'done' ? ({ paneKey, state: 'done' } as AgentStatusEntry) : undefined,
    latestEvent: null,
    latestTimestamp,
    agentType: 'claude',
    unread,
    paneTitle: paneKey,
    responsePreview: '',
    events: []
  }
}

function sectionKeys(sections: ReturnType<typeof buildAgentBoardSections>): string[][] {
  return sections.map((section) => section.threads.map((thread) => thread.paneKey))
}

describe('agent board sections', () => {
  it('puts stopped and unread finished agents first, longest wait first', () => {
    const sections = buildAgentBoardSections(
      [
        makeThread('waiting', 'waiting', 300),
        makeThread('working', 'working', 400),
        makeThread('read-done', 'done', 50),
        makeThread('blocked', 'blocked', 100),
        makeThread('unread-done', 'done', 200, true)
      ],
      null
    )
    expect(sections.map((section) => section.id)).toEqual(['attention', 'working', 'other'])
    expect(sectionKeys(sections)).toEqual([
      ['blocked', 'unread-done', 'waiting'],
      ['working'],
      ['read-done']
    ])
  })

  it('keeps the opened card in place when only its read state changes', () => {
    const held = { paneKey: 'done', statusId: 'done', sectionId: 'attention' } as const
    expect(sectionKeys(buildAgentBoardSections([makeThread('done', 'done', 10)], held))).toEqual([
      ['done'],
      [],
      []
    ])
    // A reply that restarts the agent still moves it out of the waiting section.
    expect(sectionKeys(buildAgentBoardSections([makeThread('done', 'working', 20)], held))).toEqual(
      [[], ['done'], []]
    )
  })
})
