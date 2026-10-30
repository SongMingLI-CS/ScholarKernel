import { beforeEach, expect, it, vi } from "vitest"
import { observeDurableJob } from "@/lib/agent/job-client"
class FixtureEvents {
  static current: FixtureEvents
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) { FixtureEvents.current = this }
  send(sequence: number, type: string, payload: unknown) { this.onmessage?.({ data: JSON.stringify({ sequence, type, payload }) }) }
}
beforeEach(() => { vi.stubGlobal("EventSource", FixtureEvents) })
it("replays ordered output once and closes after a terminal result", async () => {
  const output = vi.fn()
  const waiting = observeDurableJob("fixture", { onDirectChatStream: output }, new AbortController().signal)
  const source = FixtureEvents.current
  source.send(1, "output_delta", { text: "Answer" })
  source.send(1, "output_delta", { text: "Answer" })
  source.send(2, "job_completed", { final: "Answer", nodes: [], sources: [], status: "done" })
  await expect(waiting).resolves.toMatchObject({ final: "Answer" })
  expect(output).toHaveBeenCalledTimes(1)
  expect(source.close).toHaveBeenCalledOnce()
})
it("detaches an observer on page cleanup", async () => {
  const controller = new AbortController()
  const waiting = observeDurableJob("fixture", {}, controller.signal)
  controller.abort()
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" })
  expect(FixtureEvents.current.close).toHaveBeenCalledOnce()
})
