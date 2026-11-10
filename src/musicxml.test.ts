import { describe, expect, it } from 'vitest'
import { parseMusicXml } from './musicxml'
const attributes = '<attributes><divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>'
const note = (step = 'C', extra = '', duration = 4, staff = 1) => `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${staff}</voice><staff>${staff}</staff></note>`
const score = (measures: string, otherParts = '') => `<score-partwise version="4.0"><work><work-title>Synthetic study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part>${otherParts}</score-partwise>`
const measure = (body: string, attr = '') => `<measure ${attr}>${body}</measure>`
const parse = (body: string) => parseMusicXml(score(measure(attributes + '<direction><sound tempo="120"/></direction>' + body)))

describe('MusicXML import', () => {
  it('includes trailing written rests in full score duration', () => {
    const {song}=parse(note('C','',4)+'<note><rest/><duration>8</duration><voice>1</voice><staff>1</staff></note>')
    expect(song.notes[0].duration).toBe(0.5)
    expect(song.duration).toBe(1.5)
  })
  it('reads chords, backup, forward, rests, staff and per-note source indexes', () => {
    const { song } = parse(note('C', '', 4) + note('E', '<chord/>', 4) + '<note><rest/><duration>4</duration><voice>1</voice><staff>1</staff></note>' + '<backup><duration>8</duration></backup><forward><duration>4</duration></forward>' + note('G', '', 4, 2))
    expect(song.notes.map(n => [n.pitch,n.start,n.duration,n.hand,n.sourceNoteIds])).toEqual([
      [60,0,0.5,'right',['0:0:0']], [64,0,0.5,'right',['0:0:1']], [67,0.5,0.5,'left',['0:0:3']],
    ])
    expect(song.scoreOrigin).toBe('musicxml')
    expect(song.scoreXml).toContain('Synthetic study')
  })
  it('preserves onset for same-voice cross-staff chord notes', () => {
    const base=note('C', '', 4, 1)
    const crossed=note('E', '<chord/>', 4, 2).replace('<voice>2</voice>', '<voice>1</voice>')
    const {song}=parse(base+crossed+note('G', '', 4, 1))
    expect(song.notes.map(n=>[n.pitch,n.start,n.duration,n.hand])).toEqual([
      [60,0,0.5,'right'], [64,0,0.5,'left'], [67,0.5,0.5,'right'],
    ])
    expect(song.notes[1].sourceNoteIds).toEqual(['0:0:1'])
  })
  it('handles a pickup without adding silent beats, then full measures', () => {
    const { song } = parseMusicXml(score(measure(attributes + note(), 'number="0" implicit="yes"') + measure(note('D', '', 12), 'number="1"') + measure(note('E'), 'number="2"')))
    expect(song.notes.map(n => n.start)).toEqual([0,0.5,2])
  })
  it('combines ties and retains all source IDs and the printed fingering', () => {
    const first = note('C','<tie type="start"/><notations><technical><fingering>2</fingering></technical></notations>')
    const second = note('C','<tie type="stop"/>',8)
    const { song } = parseMusicXml(score(measure(attributes + first, 'implicit="yes"') + measure(second)))
    expect(song.notes).toHaveLength(1)
    expect(song.notes[0]).toMatchObject({ duration: 1.5, finger: 2, sourceNoteIds: ['0:0:0','0:1:0'] })
  })
  it('integrates tempo changes during a held note', () => {
    const { song } = parseMusicXml(score(measure(attributes + '<direction><sound tempo="120"/></direction>' + note('C','',12) + '<backup><duration>8</duration></backup><direction><sound tempo="60"/></direction>')))
    expect(song.notes[0].duration).toBeCloseTo(2.5)
    expect(song.tempo).toBe(120)
  })
  it('uses sound offset instead of enclosing direction offset for playback', () => {
    const {song}=parseMusicXml(score(measure(attributes+'<sound tempo="120"/><direction><offset>8</offset><sound tempo="60"><offset>4</offset></sound></direction>'+note('C','',16))))
    expect(song.notes[0].duration).toBeCloseTo(3.5)
  })
  it('applies offsets on direct sound elements', () => {
    const {song}=parseMusicXml(score(measure(attributes+'<sound tempo="120"/><sound tempo="60"><offset>4</offset></sound>'+note('C','',16))))
    expect(song.notes[0].duration).toBeCloseTo(3.5)
  })
  it('converts dotted metronome units into quarter-note BPM', () => {
    const { song } = parseMusicXml(score(measure(attributes + '<direction><direction-type><metronome><beat-unit>half</beat-unit><beat-unit-dot/><per-minute>40</per-minute></metronome></direction-type></direction>' + note())))
    expect(song.tempo).toBe(120)
    expect(song.notes[0].duration).toBe(0.5)
  })
  it('uses numeric durations for tuplets, including changing divisions', () => {
    const { song } = parseMusicXml(score(measure(attributes + note('C','<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>',4/3), 'implicit="yes"') + measure('<attributes><divisions>12</divisions></attributes>' + note('D','',12))))
    expect(song.notes[0].duration).toBeCloseTo(1/6)
    expect(song.notes[1].start).toBeCloseTo(1/6)
    expect(song.notes[1].duration).toBe(0.5)
  })
  it('realizes grace notes before the principal beat and warns explicitly', () => {
    const grace = '<note><grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>'
    const { song, warnings } = parse(note() + grace + note('E'))
    expect(song.notes.map(n => n.start)).toEqual([0,0.4375,0.5])
    expect(song.notes[1].duration).toBe(0.0625)
    expect(warnings.join(' ')).toMatch(/Grace notes/)
  })
  it('aligns multiple parts and applies shared tempo', () => {
    const second = '<part id="P2">' + measure(attributes + note('G','',12,2)) + '</part>'
    const { song } = parseMusicXml(score(measure(attributes + '<direction><sound tempo="60"/></direction>' + note('C','',12)),second))
    expect(song.notes.map(n => [n.start,n.duration])).toEqual([[0,3],[0,3]])
    expect(song.notes[1].sourceNoteIds).toEqual(['1:0:0'])
  })
  it('preserves namespace-qualified scores', () => {
    const xml=score(measure(attributes+note())).replace('<score-partwise version="4.0">','<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" version="4.0">')
    expect(parseMusicXml(xml).song.notes).toHaveLength(1)
  })
  it('warns about defaults, decorations and non-simple fingering without guessing', () => {
    const { song,warnings } = parseMusicXml(score(measure(attributes + note('C','<notations><fermata/><technical><fingering>1-2</fingering></technical></notations>'))))
    expect(song.notes[0].finger).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/120 BPM/)
    expect(warnings.join(' ')).toMatch(/not performed/)
    expect(warnings.join(' ')).toMatch(/compound/)
  })
  it.each(['repeat','unpitched','ending','octave-shift','tremolo'])('rejects unsupported %s explicitly', tag => {
    expect(() => parse(note() + `<${tag}/>`)).toThrow(tag)
  })
  it('reports effective tempo at each measure start, including prior in-measure changes', () => {
    const result=parseMusicXml(score(measure(attributes+'<sound tempo="90"/>'+note('C','',12)+'<backup><duration>4</duration></backup><direction><sound tempo="60"/></direction>')+measure(note('D','',12))+measure('<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>50</per-minute></metronome></direction-type></direction>'+note('E','',12))))
    expect(result.measureStartTempos).toEqual([90,60,100])
  })
  it('rejects staff references exceeding the declared staves', () => {
    expect(()=>parseMusicXml(score(measure('<attributes><divisions>4</divisions><staves>1</staves></attributes>'+note('C','',4,2))))).toThrow(/declared piano staves/)
  })
  it('rejects timewise, malformed XML, custom entities and oversized XML', () => {
    expect(() => parseMusicXml('<score-timewise/>')).toThrow(/timewise/)
    expect(() => parseMusicXml('<score-partwise><x></score-partwise>')).toThrow(/well-formed/)
    expect(() => parseMusicXml('<!DOCTYPE x [<!ENTITY a "x">]><score-partwise/>')).toThrow(/entities/)
    expect(() => parseMusicXml('x'.repeat(5*1024*1024+1))).toThrow(/5 MiB/)
  })
  it('accepts standard external MusicXML doctype without fetching it', () => {
    const xml='<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "https://example.invalid/partwise.dtd">'+score(measure(attributes+note()))
    expect(parseMusicXml(xml).song.notes).toHaveLength(1)
  })
  it('rejects invalid timing, hanging ties, microtones and orphan chords', () => {
    expect(() => parse('<backup><duration>4</duration></backup>'+note())).toThrow(/backup/)
    expect(() => parse(note('C','<tie type="start"/>'))).toThrow(/tie/)
    expect(() => parse(note('C','<tie type="stop"/>'))).toThrow(/tie/)
    expect(() => parse(note('C','<chord/>'))).toThrow(/chord/)
    expect(() => parse(note().replace('<step>C</step>','<step>C</step><alter>0.5</alter>'))).toThrow(/microtones/)
  })
  it('rejects conflicting tempo and grace notes without previous time', () => {
    expect(() => parse('<direction><sound tempo="60"/></direction>'+note())).toThrow(/conflicting tempo/)
    expect(() => parse('<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>'+note())).toThrow(/beginning/)
  })
})
