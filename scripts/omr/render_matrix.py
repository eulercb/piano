"""Author/render the small ORIGINAL synthetic OMR matrix, never engine output.

Optional developer tools: Verovio 6.4.1, CairoSVG 2.8.2, Pillow 13.0.0.
No downloads, application dependencies, or private/existing compositions.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'fixtures' / 'omr' / 'matrix'
ATTRIBUTES = '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'


def note(step, octave, staff, duration, kind, *, alter=0, dot=False, chord=False, tie=None, beam=None):
    pitch = '<rest/>' if step is None else f'<pitch><step>{step}</step>' + (f'<alter>{alter}</alter>' if alter else '') + f'<octave>{octave}</octave></pitch>'
    sound_tie = f'<tie type="{tie}"/>' if tie else ''
    accidental = f'<accidental>{"sharp" if alter == 1 else "flat"}</accidental>' if alter else ''
    return ('<note>' + ('<chord/>' if chord else '') + pitch + f'<duration>{duration}</duration>' + sound_tie
            + f'<voice>{staff}</voice><type>{kind}</type>' + ('<dot/>' if dot else '') + accidental
            + f'<staff>{staff}</staff>' + (f'<beam number="1">{beam}</beam>' if beam else '')
            + (f'<notations><tied type="{tie}"/></notations>' if tie else '') + '</note>')


def triad(steps, duration, tie=None):
    return ''.join(note(s, 4, 1, duration, 'half', chord=i > 0, tie=tie) for i, s in enumerate(steps))


def score(title, measures):
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>' + title
            + '</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
            + ''.join(f'<measure number="{i+1}">' + (ATTRIBUTES if i == 0 else '') + right
                      + '<backup><duration>8</duration></backup>' + left + '</measure>' for i, (right, left) in enumerate(measures))
            + '</part></score-partwise>')


def originals():
    rhythm = score('Original rhythm and accidental study', [
        (note('C', 4, 1, 3, 'quarter', dot=True) + note('D', 4, 1, 1, 'eighth')
         + note('F', 4, 1, 2, 'quarter', alter=1) + note('G', 4, 1, 2, 'quarter'),
         note('C', 3, 2, 4, 'half') + note(None, 0, 2, 2, 'quarter') + note('G', 2, 2, 2, 'quarter')),
        (note('E', 4, 1, 2, 'quarter', alter=-1) + note('F', 4, 1, 1, 'eighth', beam='begin')
         + note('G', 4, 1, 1, 'eighth', beam='end') + note(None, 0, 1, 2, 'quarter') + note('A', 4, 1, 2, 'quarter'),
         note('A', 2, 2, 6, 'half', dot=True) + note(None, 0, 2, 2, 'quarter')),
    ])
    chords = score('Original chord and tie study', [
        (triad('CEG', 4) + triad('DFA', 4, 'start'), note('C', 3, 2, 8, 'whole')),
        (triad('DFA', 4, 'stop') + triad('CEG', 4), note('F', 2, 2, 4, 'half') + note('C', 3, 2, 4, 'half')),
    ])
    return {'rhythm-accidentals': rhythm, 'chords-ties': chords}


def main():
    import verovio
    import cairosvg
    from PIL import Image

    ROOT.mkdir(parents=True, exist_ok=True)
    for name, xml in originals().items():
        (ROOT / f'{name}.musicxml').write_text(xml, encoding='utf-8')
        renderer = verovio.toolkit()
        renderer.setOptions({'pageWidth': 2100, 'pageHeight': 1000, 'scale': 100, 'adjustPageHeight': True,
                             'breaks': 'none', 'header': 'none', 'footer': 'none'})
        if not renderer.loadData(xml) or renderer.getPageCount() != 1:
            raise ValueError('Expected exactly one rendered page')
        cairosvg.svg2png(bytestring=renderer.renderToSVG(1).encode(), write_to=str(ROOT / f'{name}.png'),
                        scale=2, background_color='white')
    with Image.open(ROOT / 'rhythm-accidentals.png') as source:
        # Fixed, reproducible perturbation, NOT a simulated camera benchmark.
        gray = source.convert('L').point([round(45 + value * 0.75) for value in range(256)])
        gray.rotate(1.0, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=236).save(ROOT / 'rhythm-skew-contrast.png')
    print(json.dumps({'verovio': renderer.getVersion(), 'cairosvg': cairosvg.__version__, 'pillow': Image.__version__}))


if __name__ == '__main__':
    main()
