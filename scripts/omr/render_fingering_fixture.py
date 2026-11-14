"""Original two-staff fingering exercise; optional developer rendering only.

The gold is authored here, never derived from recognizer output. No downloads.
Rendering requires separately provisioned Verovio and CairoSVG; record versions.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'fixtures' / 'omr' / 'fingering'


def note(step, octave, staff, finger=None, *, chord=False):
    mark = '' if finger is None else ('<notations><technical><fingering placement="'
            + ('above' if staff == 1 else 'below') + f'">{finger}</fingering></technical></notations>')
    return ('<note>' + ('<chord/>' if chord else '') + f'<pitch><step>{step}</step><octave>{octave}</octave></pitch>'
            + f'<duration>1</duration><voice>{staff}</voice><type>quarter</type><stem>'
            + ('up' if staff == 1 else 'down') + f'</stem><staff>{staff}</staff>' + mark + '</note>')


def original():
    attributes = ('<attributes><divisions>1</divisions><key><fifths>0</fifths></key>'
                  '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'
                  '<clef number="1"><sign>G</sign><line>2</line></clef>'
                  '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>')
    first_right = ''.join(note(step, 4, 1, finger) for step, finger in [('C', 1), ('D', 2), ('E', None), ('F', 4)])
    first_left = ''.join(note(step, octave, 2, finger) for step, octave, finger in [('C', 3, 5), ('B', 2, 4), ('A', 2, None), ('G', 2, 2)])
    second_right = (note('G', 4, 1, 5) + note('E', 4, 1, 1) + note('G', 4, 1, 3, chord=True)
                    + note('F', 4, 1) + note('E', 4, 1, 2))
    second_left = ''.join(note(step, 3, 2, finger) for step, finger in [('F', 1), ('E', 2), ('D', 3), ('C', None)])
    # A direction numeral is intentionally NOT a finger. Keep it in the image.
    direction = '<direction placement="above"><direction-type><words default-y="60">3</words></direction-type><staff>1</staff></direction>'
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">'
            '<work><work-title>Original fingering attachment exercise</work-title></work>'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
            '<measure number="1">' + attributes + first_right + '<backup><duration>4</duration></backup>' + first_left + '</measure>'
            '<measure number="2">' + direction + second_right + '<backup><duration>4</duration></backup>' + second_left + '</measure>'
            '</part></score-partwise>')


def main():
    import verovio
    import cairosvg
    ROOT.mkdir(parents=True, exist_ok=True)
    xml = original()
    (ROOT / 'piano-fingerings.musicxml').write_text(xml, encoding='utf-8')
    renderer = verovio.toolkit()
    renderer.setOptions({'pageWidth': 2100, 'pageHeight': 1000, 'scale': 100,
                         'adjustPageHeight': True, 'breaks': 'none', 'header': 'none', 'footer': 'none'})
    if not renderer.loadData(xml) or renderer.getPageCount() != 1:
        raise ValueError('Expected one page for the original fingering fixture')
    cairosvg.svg2png(bytestring=renderer.renderToSVG(1).encode(), write_to=str(ROOT / 'piano-fingerings.png'),
                    scale=2, background_color='white')
    print(json.dumps({'verovio': renderer.getVersion(), 'cairosvg': cairosvg.__version__}))


if __name__ == '__main__':
    main()
