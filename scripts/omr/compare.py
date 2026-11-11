"""Compare fixture MusicXML events. Not a general notation equivalence checker."""
from collections import Counter
from fractions import Fraction
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from timing import check_timing, positive_number


def note_tone(node):
    pitches, rests = node.findall('pitch'), node.findall('rest')
    if node.find('unpitched') is not None or len(pitches) + len(rests) != 1:
        raise ValueError('Compared notes require exactly one explicit pitch or rest; unpitched notes are unsupported')
    if rests:
        return 'rest'
    pitch = pitches[0]
    step, octave = pitch.findtext('step', '').strip(), pitch.findtext('octave', '').strip()
    alter = pitch.findtext('alter', '0').strip()
    if (len(pitch.findall('step')) != 1 or len(pitch.findall('octave')) != 1 or len(pitch.findall('alter')) > 1
            or step not in ('A', 'B', 'C', 'D', 'E', 'F', 'G') or not re.fullmatch(r'[0-9]', octave)
            or len(alter) > 32 or not re.fullmatch(r'[+-]?[0-9]+(?:\.0+)?', alter)):
        raise ValueError('Compared pitches require one A–G step, octave 0–9 and an optional integer semitone alteration')
    return step, str(int(Fraction(alter))), octave


def events(path, written=False):
    root = ET.fromstring(Path(path).read_bytes())
    if root.tag != 'score-partwise' or any(node.tag.startswith('{') for node in root.iter()):
        raise ValueError('Comparison supports only unnamespaced score-partwise MusicXML')
    check_timing(root)
    result = []
    for p, part in enumerate(root.findall('part')):
        divisions = 1
        for m, measure in enumerate(part.findall('measure')):
            position = Fraction(0)
            previous = Fraction(0)
            for node in measure:
                if node.tag == 'attributes':
                    if node.find('divisions') is not None:
                        divisions = positive_number(node.findtext('divisions'), 'divisions')
                elif node.tag in ('backup', 'forward'):
                    position += positive_number(node.findtext('duration'), 'duration') / divisions * (-1 if node.tag == 'backup' else 1)
                elif node.tag == 'note':
                    duration = Fraction(0) if node.find('grace') is not None else positive_number(node.findtext('duration'), 'duration') / divisions
                    onset = previous if node.find('chord') is not None else position
                    tone = note_tone(node)
                    event = (p, m, node.findtext('staff', '1'), str(onset), str(duration), str(tone), node.findtext('voice', '1'))
                    if written:
                        event = event[:-1] + (node.findtext('type', ''), len(node.findall('dot')),
                                              tuple(sorted(n.get('type', '') for n in node.findall('tie'))),
                                              tuple(sorted(n.get('type', '') for n in node.findall('./notations/tied'))))
                    result.append(event)
                    if node.find('chord') is None:
                        previous = position
                        position += duration
    if not result:
        raise ValueError('Comparison requires at least one written note or rest event')
    return result


def compare_events(gold, output):
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
    expected_written, actual_written = Counter(events(gold, written=True)), Counter(events(output, written=True))
    written_exact = sum((expected_written & actual_written).values())
    def differences(left, right):
        return [{'event': event, 'count': count} for event, count in sorted((left - right).items())]
    return {'comparable': True, 'voice_partition_matches': voice_bijection, 'gold_events': len(expected), 'recognized_events': len(actual), 'exact_pitch_onset_duration_staff_measure_matches': exact,
            'precision': exact / len(actual) if actual else 0, 'recall': exact / len(expected) if expected else 0,
            'exact_written_type_dot_tie_matches': written_exact,
            'written_type_dot_tie_matches': expected_written == actual_written,
            'missing_events': differences(Counter(e[:-1] for e in expected), Counter(e[:-1] for e in actual)),
            'unexpected_events': differences(Counter(e[:-1] for e in actual), Counter(e[:-1] for e in expected)),
            'missing_written_events': differences(expected_written, actual_written),
            'unexpected_written_events': differences(actual_written, expected_written),
            'voice_mapping': {str(k): sorted(v) for k, v in mappings.items()},
            'scope': 'Event multiset, measure index, staff and voice correspondence; written type, dot count, sound ties and visible ties. Not full notation/engraving equivalence.'}


def compare(gold, output):
    try:
        return compare_events(gold, output)
    except (ValueError, OSError, ET.ParseError) as exc:
        # Invalid timing cannot receive an accuracy percentage or be silently
        # rescaled to fit gold. Keep an actionable failure in batch reports.
        return {'comparable': False, 'error': str(exc), 'scope': 'No event accuracy measured: invalid or unreadable MusicXML.'}


if __name__ == '__main__':
    result = compare(*sys.argv[1:])
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['comparable'] else 1)
