"""Small MusicXML timing checks, not a substitute for the app importer."""
from fractions import Fraction
import re


def positive_number(text, label):
    # MusicXML positive-divisions is decimal, not an exponent or fraction.
    value = (text or '').strip()
    if len(value) > 64 or not re.fullmatch(r'\+?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)', value):
        raise ValueError(f'Invalid MusicXML {label}: expected a positive decimal')
    number = Fraction(value)
    if not 0 < number <= 10_000_000:
        raise ValueError(f'Invalid MusicXML {label}: must be greater than zero and at most 10000000')
    return number


def check_timing(root):
    for p, part in enumerate(root.findall('part'), 1):
        divisions = None
        for m, measure in enumerate(part.findall('measure'), 1):
            where = f'in part {p}, measure {m}'
            for node in measure:
                if node.tag == 'attributes' and node.find('divisions') is not None:
                    divisions = positive_number(node.findtext('divisions'), f'divisions {where}')
                elif node.tag in ('note', 'backup', 'forward'):
                    if node.tag == 'note' and node.find('grace') is not None:
                        continue
                    if divisions is None:
                        raise ValueError(f'Invalid MusicXML timing {where}: duration appears before divisions')
                    positive_number(node.findtext('duration'), f'duration {where}')
