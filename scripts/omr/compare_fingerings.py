"""Compare exact fingering attachments for a small, synthetic two-staff piano score.

Counts describe exact written-note attachment keys, not a diagnostic for why
recognition failed. For example, a lost marked note is both a missing note and
a missing mark; a mark on an unexpected note is both an extra mark and an
unexpected note. Unassessable entries count distinct keys, not candidate marks.
No fingering accuracy percentage is assigned.
"""

import argparse
from collections import defaultdict
from fractions import Fraction
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from compare import compare as compare_events, note_tone
from timing import check_timing, positive_number

MAX_BYTES = 1024 * 1024
MAX_EVENTS = 512
DIGITS = frozenset('012345')
CATEGORIES = ('correct_marks', 'missing_marks', 'incorrect_marks', 'extra_marks',
              'correct_unmarked', 'missing_notes', 'unexpected_notes', 'unassessable_notes')


def load(path):
    with Path(path).open('rb') as source:
        data = source.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Fingering comparison input exceeds 1 MiB')
    if re.search(rb'<!ENTITY\b|<!DOCTYPE[^>]*\[', data, re.I):
        raise ValueError('Entity declarations and internal DTD subsets are not supported')
    root = ET.fromstring(data.decode('utf-8'))
    if root.tag != 'score-partwise' or any(node.tag.startswith('{') for node in root.iter()):
        raise ValueError('Fingering comparison requires unnamespaced score-partwise MusicXML')
    notes = list(root.iter('note'))
    if not 0 < len(notes) <= MAX_EVENTS:
        raise ValueError('Fingering comparison requires 1–512 written events')
    # The timing helper reads scalar values. Reject duplicate fields rather
    # than silently selecting the first and accepting contradictory metadata.
    for node in root.iter():
        if node.tag in ('duration', 'divisions', 'staff', 'voice', 'step', 'octave', 'alter', 'type') and len(node):
            raise ValueError('Compared scalar fields must contain text only')
        if node.tag in ('note', 'backup', 'forward') and node.find('grace') is None:
            if len(node.findall('duration')) != 1:
                raise ValueError('Each timed event requires exactly one duration')
        if node.tag == 'attributes' and len(node.findall('divisions')) > 1:
            raise ValueError('Attributes may contain only one divisions value')
        if node.tag == 'note' and any(len(node.findall(tag)) > 1 for tag in ('chord', 'voice', 'staff')):
            raise ValueError('A note may contain only one chord flag, voice and staff value')
    check_timing(root)
    return root


def attachments(root):
    parts = root.findall('part')
    if len(parts) != 1:
        raise ValueError('Fingering comparison requires exactly one piano part')

    found = defaultdict(list)
    seen_marks = 0
    divisions = None
    for m, measure in enumerate(parts[0].findall('measure'), 1):
        position = Fraction(0)
        anchor = None
        for node in measure:
            if node.tag == 'attributes' and node.find('divisions') is not None:
                divisions = positive_number(node.findtext('divisions'), 'divisions')
            elif node.tag in ('backup', 'forward'):
                shift = positive_number(node.findtext('duration'), 'duration') / divisions
                position += -shift if node.tag == 'backup' else shift
                if position < 0:
                    raise ValueError('Negative measure-relative position is unsupported')
                anchor = None
            elif node.tag == 'note':
                if node.find('grace') is not None:
                    raise ValueError('Grace-note attachment is outside the fingering fixture subset')
                duration = positive_number(node.findtext('duration'), 'duration') / divisions
                voice = node.findtext('voice', '1').strip()
                staff = node.findtext('staff', '1').strip()
                if staff not in ('1', '2') or not voice or len(node.findall('staff')) > 1:
                    raise ValueError('Expected a unique staff 1 or 2 and a nonempty voice')
                tone = note_tone(node)
                if node.find('chord') is None:
                    onset = position
                    position += duration
                    anchor = (onset, staff, voice) if tone != 'rest' else None
                elif anchor is not None and anchor[1:] == (staff, voice) and tone != 'rest':
                    onset = anchor[0]
                else:
                    raise ValueError('Chord member has no preceding pitched anchor in the same staff and voice')
                marks = node.findall('./notations/technical/fingering')
                seen_marks += len(marks)
                if tone == 'rest':
                    if marks:
                        raise ValueError('Fingering on a rest is outside the piano-note subset')
                    continue
                # Order-independent for chord heads. Voice identifiers are not
                # stable across exports; same-key unisons are unassessable.
                key = (1, m, staff, onset, tone)
                labels = [(mark.text or '').strip()[:32] for mark in marks[:2]]
                if not marks:
                    found[key].append((None, None))
                elif (len(marks) != 1 or len(marks[0]) or labels[0] not in DIGITS
                      or any(marks[0].get(attr, 'no') != 'no' for attr in ('alternate', 'substitution'))):
                    found[key].append((None, {'mark_count': len(marks), 'sample_values': labels}))
                else:
                    found[key].append((int(labels[0]), None))
    if seen_marks != sum(1 for _ in root.iter('fingering')):
        raise ValueError('Fingering outside pitched note technical notation is unsupported')
    return found


def compare_attachments(gold, actual):
    if {key[2] for key in gold} != {'1', '2'}:
        raise ValueError('Gold must contain pitched notes on both piano staves')
    details = {category: [] for category in CATEGORIES}

    def record(category, key, **fields):
        p, m, staff, onset, (step, alter, octave) = key
        details[category].append({'part': p, 'measure': m, 'staff': int(staff),
                                  'written_hand': 'right' if staff == '1' else 'left',
                                  'onset_quarters': str(onset),
                                  'pitch': {'step': step, 'alter': int(alter), 'octave': int(octave)}, **fields})

    for key in sorted(gold.keys() | actual.keys()):
        expected, observed = gold.get(key, []), actual.get(key, [])
        if len(expected) > 1 or len(observed) > 1:
            record('unassessable_notes', key, reason='ambiguous_duplicate_note_key',
                   expected_notes=len(expected), actual_notes=len(observed))
            continue
        wanted, gold_invalid = expected[0] if expected else (None, None)
        got, output_invalid = observed[0] if observed else (None, None)
        if not expected:
            record('unexpected_notes', key)
        if not observed:
            record('missing_notes', key)
        if gold_invalid is not None or wanted == 0 or output_invalid is not None:
            record('unassessable_notes', key, reason='unsupported_fingering',
                   expected_mark=wanted, actual_mark=got,
                   unsupported_gold=gold_invalid, unsupported_output=output_invalid,
                   invalid_for_piano=(wanted == 0))
        elif wanted is not None and got is None:
            record('missing_marks', key, expected_mark=wanted)
        elif got is not None and wanted is None:
            record('extra_marks', key, actual_mark=got, invalid_for_piano=(got == 0))
        elif wanted != got:
            record('incorrect_marks', key, expected_mark=wanted, actual_mark=got, invalid_for_piano=(got == 0))
        elif wanted is not None:
            record('correct_marks', key, expected_mark=wanted, actual_mark=got)
        elif expected and observed:
            record('correct_unmarked', key)

    counts = {category: len(items) for category, items in details.items()}
    return {'comparable': not counts['unassessable_notes'],
            'passes': not any(counts[category] for category in CATEGORIES
                              if category not in ('correct_marks', 'correct_unmarked')),
            'counts': counts, 'details': details}


def compare(gold, output):
    """Separate exact note attachment from the existing rhythm/voice/written-event gate."""
    metrics = {'passes': False, 'events_pass': False, 'events': None,
               'fingerings': {'comparable': False, 'passes': False},
               'scope': 'Synthetic single-part piano. Exact measure-relative onset, staff and written pitch; '
                        'duration and voice identifiers are not attachment keys. Written hand is staff assignment.'}
    try:
        gold_xml, output_xml = load(gold), load(output)
        events = compare_events(gold, output)
        metrics['events'] = events
        metrics['events_pass'] = (
            events['comparable'] and events['voice_partition_matches'] and
            not events['missing_events'] and not events['unexpected_events'] and
            events['written_type_dot_tie_matches'])
        metrics['fingerings'] = compare_attachments(attachments(gold_xml), attachments(output_xml))
        metrics['passes'] = metrics['events_pass'] and metrics['fingerings']['passes']
    except (ValueError, OSError, ET.ParseError) as exc:
        metrics['fingerings']['error'] = str(exc)
    return metrics


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gold')
    parser.add_argument('output')
    args = parser.parse_args()
    result = compare(args.gold, args.output)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passes'] else 1)
