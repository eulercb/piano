"""Compare fixture MusicXML events. Not a general notation equivalence checker."""
from collections import Counter
from fractions import Fraction
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def events(path):
    root = ET.fromstring(Path(path).read_bytes())
    result = []
    for p, part in enumerate(root.findall('part')):
        divisions = 1
        for m, measure in enumerate(part.findall('measure')):
            position = Fraction(0)
            previous = Fraction(0)
            for node in measure:
                if node.tag == 'attributes':
                    divisions = int(node.findtext('divisions', str(divisions)))
                elif node.tag in ('backup', 'forward'):
                    position += Fraction(int(node.findtext('duration')), divisions) * (-1 if node.tag == 'backup' else 1)
                elif node.tag == 'note':
                    duration = Fraction(int(node.findtext('duration', '0')), divisions)
                    onset = previous if node.find('chord') is not None else position
                    pitch = node.find('pitch')
                    tone = 'rest' if pitch is None else (pitch.findtext('step'), pitch.findtext('alter', '0'), pitch.findtext('octave'))
                    result.append((p, m, node.findtext('staff', '1'), str(onset), str(duration), str(tone), node.findtext('voice', '1')))
                    if node.find('chord') is None:
                        previous = position
                        position += duration
    return result


def compare(gold, output):
    expected, actual = events(gold), events(output)
    # Voice IDs are arbitrary: staff-specific partition correspondence is tested
    # separately, not mistaken for different musical content.
    exact = sum((Counter(e[:-1] for e in expected) & Counter(e[:-1] for e in actual)).values())
    mappings = {}
    for e in expected:
        matches = [a for a in actual if a[:-1] == e[:-1]]
        if len(matches) == 1:
            mappings.setdefault((e[0], e[2], e[-1]), set()).add(matches[0][-1])
    voice_bijection = set(mappings) == {(e[0], e[2], e[-1]) for e in expected} and all(sum(a[:-1] == e[:-1] for a in actual) == 1 for e in expected) and exact == len(expected) == len(actual) and all(len(v) == 1 for v in mappings.values()) and len({(k[0], k[1], next(iter(v))) for k, v in mappings.items() if len(v) == 1}) == len(mappings)
    return {'voice_partition_matches': voice_bijection, 'gold_events': len(expected), 'recognized_events': len(actual), 'exact_pitch_onset_duration_staff_measure_matches': exact,
            'precision': exact / len(actual) if actual else 0, 'recall': exact / len(expected) if expected else 0,
            'voice_mapping': {str(k): sorted(v) for k, v in mappings.items()},
            'scope': 'Event multiset, measure index, staff and voice correspondence; no notation/engraving correctness claim'}


if __name__ == '__main__':
    print(json.dumps(compare(*sys.argv[1:]), indent=2))
