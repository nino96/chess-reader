"""Apply the predeclared promotion rules to all frozen browser measurements."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def promotion(test: dict, regression: dict, control: dict, rules: dict) -> dict[str, bool]:
    return {
        'heldOutReliableExact': test['reliableExact'] / test['totalBoards'] >= rules['minimumExactBoardAccuracy'],
        'heldOutConfidentCorrectSquares': test['confidentCorrectSquares'] / test['totalSquares'] >= rules['minimumSquareAccuracy'],
        'heldOutZeroReliableWrong': test['reliableWrong'] <= rules['maximumReliableWrong'],
        'regressionReliableExact': regression['reliableExact'] >= control['reliableExact'],
        'regressionCorrectSquares': regression['correctSquares'] >= control['correctSquares'],
        'regressionReliableWrong': regression['reliableWrong'] <= control['reliableWrong'],
    }


def summarize(directory: Path) -> dict:
    root = Path(__file__).parent
    protocol = json.loads((root / 'protocol.json').read_text())
    freeze = json.loads((root / 'reports/candidates-freeze.json').read_text())
    candidates = {entry['id']: entry for entry in freeze['candidates']}
    output = {'schemaVersion': 1, 'command': 'python3 experiments/recognition-training/summarize.py --reports experiments/recognition-training/reports --output experiments/recognition-training/runs/comparison.json',
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'protocolSha256': hashlib.sha256((root / 'protocol.json').read_bytes()).hexdigest(),
              'decision': 'STOP', 'candidates': [], 'artifacts': {}, 'physicalIpad': 'deferred/unrun'}
    def read(name: str) -> dict:
        raw = (directory / name).read_bytes()
        output['artifacts'][name] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)
    for browser in ('chromium', 'firefox', 'webkit'):
        rows = {}
        for candidate_id, identity in candidates.items():
            for role, count in (('print-held-out-v1', 256), ('corpus-v1-regression', 14)):
                report = read(f'browser-{browser}-{candidate_id}-{role}.json')
                summary = report['summary']
                if (report['candidate']['modelSha256'] != identity['sha256'] or
                    report['freeze']['protocolSha256'] != output['protocolSha256'] or
                    report['freeze']['testManifestSha256'] != freeze['testManifestSha256'] or
                    report['environment']['browser']['name'] != browser or
                    report['contract']['reliabilityFloor'] != protocol['confidenceFloor'] or
                    report['nonSameOriginRequests'] or summary['totalBoards'] != count or
                    summary['totalSquares'] != count * 64 or len(report['observations']) != count or
                    sum(map(sum, summary['confusion'])) != count * 64 or
                    len(report['rawTiming']['fullPassInferenceMs']) != count):
                    raise ValueError('Incomplete or inconsistent browser evidence')
                rows[(candidate_id, role)] = report
            faults = read(f'browser-faults-{browser}-{candidate_id}.json')
            if (faults['candidate']['sha256'] != identity['sha256'] or faults['nonSameOriginRequests'] or
                not all(faults[key]['passed'] for key in ('cancellation', 'timeoutTerminationAndRecovery',
                    'modelIntegrityFailureBeforeInference', 'warmOfflineInference'))):
                raise ValueError('Browser fault/privacy gate failed')
        for candidate_id in candidates:
            test = rows[(candidate_id, 'print-held-out-v1')]
            regression = rows[(candidate_id, 'corpus-v1-regression')]
            control = rows[('shipped', 'corpus-v1-regression')]
            if test['vectors']['sha256'] != rows[('shipped', 'print-held-out-v1')]['vectors']['sha256'] or regression['vectors']['sha256'] != control['vectors']['sha256']:
                raise ValueError('Candidates did not receive identical vectors')
            checks = promotion(test['summary'], regression['summary'], control['summary'], protocol['promotion'])
            output['candidates'].append({'browser': browser, 'candidate': candidate_id,
                'eligible': all(checks.values()), 'promotionChecks': checks,
                'heldOut': test['summary'], 'regression': regression['summary'],
                'timing': test['timing'], 'runtime': test['runtime']})
    seeded = [row for row in output['candidates'] if row['candidate'] != 'shipped']
    if any(all(row['eligible'] for row in seeded if row['candidate'] == identity) for identity in candidates if identity != 'shipped'):
        output['decision'] = 'Eligible for later integration decision only; production adoption not authorized'
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reports', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(summarize(args.reports), indent=2) + '\n')
