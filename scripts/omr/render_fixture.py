"""Render an original two-bar piano exercise. Optional evaluation tools only.
Requires verovio 6.4.1 and CairoSVG 2.8.2; not application dependencies.
"""
from pathlib import Path
import verovio
import cairosvg

root = Path(__file__).resolve().parents[2] / 'fixtures' / 'omr'

def note(step, octave, staff):
    return f'<note><pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>1</duration><voice>{staff}</voice><type>quarter</type><staff>{staff}</staff></note>'

attributes = '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
measures = []
for i, (right, left) in enumerate([('CDEF', 'CDEF'), ('GFED', 'GFED')]):
    measures.append(f'<measure number="{i+1}">' + (attributes if i == 0 else '') + ''.join(note(s, 4, 1) for s in right) + '<backup><duration>4</duration></backup>' + ''.join(note(s, 3, 2) for s in left) + '</measure>')
xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Original OMR exercise</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' + ''.join(measures) + '</part></score-partwise>'
(root / 'piano-quarter-notes.musicxml').write_text(xml)
tk = verovio.toolkit()
tk.setOptions({'pageWidth': 2100, 'pageHeight': 1000, 'scale': 100, 'adjustPageHeight': True, 'breaks': 'none', 'header': 'none', 'footer': 'none'})
assert tk.loadData(xml)
svg = tk.renderToSVG(1)
cairosvg.svg2png(bytestring=svg.encode(), write_to=str(root / 'piano-quarter-notes.png'), scale=2, background_color="white")
print(tk.getVersion())
