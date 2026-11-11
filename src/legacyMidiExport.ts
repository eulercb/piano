/** The already quantized legacy stream: preserve its bytes whenever FIFO
 * reimport retains the musical tuples, regardless of source note identities. */
export type LegacyMidiEvent = { tick: number; end: number; off: boolean; data: number[] }

export function guardLegacyMidiEvents(events: LegacyMidiEvent[]): void {
  const expected = new Map<string, number>()
  const tuple = (key: string, start: number, end: number, velocity: number) => `${key}:${start}:${end}:${velocity}`
  for (const event of events) if (!event.off) {
    const key = tuple(`${event.data[0] & 15}:${event.data[1]}`, event.tick, event.end, event.data[2])
    expected.set(key, (expected.get(key) ?? 0) + 1)
  }
  const faithful = () => {
    const remaining = new Map(expected)
    const active = new Map<string, LegacyMidiEvent[]>()
    let matches = true
    for (const event of events) {
      const key = `${event.data[0] & 15}:${event.data[1]}`
      const queue = active.get(key) ?? []
      if (!event.off) {
        if (queue.length >= 1024) throw new Error('Cannot export MIDI: too many notes overlap at one hand and pitch (maximum 1,024). Export a Piano project instead.')
        queue.push(event)
        active.set(key, queue)
      } else {
        const start = queue.shift()
        const restored = start && tuple(key, start.tick, event.tick, start.data[2])
        const count = restored ? remaining.get(restored) ?? 0 : 0
        if (!count) matches = false
        else remaining.set(restored!, count - 1)
      }
    }
    return matches && [...remaining.values()].every(count => count === 0)
  }
  if (faithful()) return
  // Simultaneous starts can be represented by enqueueing earlier endings
  // first. Never move an onset or release, or change the legacy tick clock.
  events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off)
    || (!a.off && !b.off ? a.end - b.end : 0))
  if (!faithful()) throw new Error('Cannot export MIDI: overlapping notes at the same hand and pitch would change individual durations or velocities. Export a Piano project or available MusicXML instead.')
}
