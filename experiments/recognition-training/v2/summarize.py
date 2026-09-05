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


def stratified_test_metrics(report: dict, render_by_board: dict[str, dict]) -> dict[str, dict[str, dict]]:
    """Expose texture/degradation failures that an aggregate score can hide."""
    groups: dict[str, dict[str, dict[str, int]]] = {
        'texture': {}, 'reduction': {}, 'speckle': {},
    }
    observations = report.get('observations')
    if not isinstance(observations, list) or len(observations) != len(render_by_board):
        raise ValueError('Held-out browser observations do not cover the locked v2 boards')
    seen: set[str] = set()
    for observation in observations:
        if not isinstance(observation, dict):
            raise ValueError('Held-out browser observation is invalid')
        board_id = observation.get('boardId')
        if not isinstance(board_id, str) or board_id in seen or board_id not in render_by_board:
            raise ValueError('Held-out browser observation does not bind an opaque v2 board identity')
        seen.add(board_id)
        render = render_by_board[board_id]
        strata = {
            'texture': render['style'],
            'reduction': str(render['reduction']),
            'speckle': 'present' if render['speckles'] > 0 else 'none',
        }
        exact = observation.get('exact') is True
        reliable = observation.get('reliable') is True
        reliable_wrong = observation.get('reliableWrong') is True
        correct_squares = observation.get('correctSquares')
        if not isinstance(correct_squares, int) or not 0 <= correct_squares <= 64:
            raise ValueError('Held-out browser observation has invalid square metrics')
        for dimension, value in strata.items():
            bucket = groups[dimension].setdefault(value, {
                'boards': 0, 'correctSquares': 0, 'exactBoards': 0,
                'reliableExactBoards': 0, 'reliableWrongBoards': 0, 'lowConfidenceBoards': 0,
            })
            bucket['boards'] += 1
            bucket['correctSquares'] += correct_squares
            bucket['exactBoards'] += int(exact)
            bucket['reliableExactBoards'] += int(exact and reliable)
            bucket['reliableWrongBoards'] += int(reliable_wrong)
            bucket['lowConfidenceBoards'] += int(not reliable)
    output: dict[str, dict[str, dict]] = {}
    for dimension, buckets in groups.items():
        output[dimension] = {}
        for value, metrics in buckets.items():
            boards = metrics['boards']
            output[dimension][value] = {
                **metrics,
                'rawExactBoardAccuracy': metrics['exactBoards'] / boards,
                'rawSquareAccuracy': metrics['correctSquares'] / (boards * 64),
                'reliableExactBoardAccuracy': metrics['reliableExactBoards'] / boards,
                # Individual confident-correct squares are not retained by the unchanged browser harness.
                'confidentSquareAccuracy': None,
            }
    return output


def summarize(directory: Path) -> dict:
    root = Path(__file__).parent
    protocol = json.loads((root / 'protocol.json').read_text())
    freeze = json.loads((root / 'reports/candidates-freeze.json').read_text())
    dataset_bytes = (root / 'data/full/dataset-manifest.json').read_bytes()
    strata = json.loads((root / 'manifests/strata-v2.json').read_text())
    boards = strata.get('boards') if isinstance(strata, dict) else None
    if (not isinstance(strata, dict) or strata.get('schemaVersion') != 1 or
            strata.get('datasetManifestSha256') != hashlib.sha256(dataset_bytes).hexdigest() or
            not isinstance(boards, list) or len(boards) != protocol['full']['testBoards']):
        raise ValueError('v2 held-out render metadata is unavailable')
    render_by_board: dict[str, dict] = {}
    for board in boards:
        if not isinstance(board, dict) or board.get('role') != 'test' or not isinstance(board.get('boardId'), str):
            raise ValueError('v2 held-out render metadata is invalid')
        if (board.get('style') not in ('flat', 'hatch', 'halftone') or board.get('reduction') not in (1, .82, .64) or
                not isinstance(board.get('speckled'), bool) or board['boardId'] in render_by_board):
            raise ValueError('v2 held-out render metadata is incomplete')
        render_by_board[board['boardId']] = {
            'style': board['style'], 'reduction': board['reduction'],
            'speckles': 1 if board['speckled'] else 0,
        }
    candidates = {entry['id']: entry for entry in freeze['candidates']}
    output = {'schemaVersion': 1, 'command': 'python3 experiments/recognition-training/v2/summarize.py --reports experiments/recognition-training/v2/reports --output experiments/recognition-training/v2/runs/comparison.json',
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'protocolSha256': hashlib.sha256((root / 'protocol.json').read_bytes()).hexdigest(),
                'decision': 'STOP', 'candidates': [], 'artifacts': {}, 'physicalIpad': 'deferred/unrun',
                'stratification': {'source': 'opaque held-out board render metadata', 'confidenceQualifiedSquares': 'unavailable per board in unchanged browser evidence'}}
    def read(name: str) -> dict:
        raw = (directory / name).read_bytes()
        output['artifacts'][name] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)
    fidelity = read('svg-fidelity.json')
    output['sourceFidelityStatus'] = fidelity['status']
    if fidelity['status'] != 'passed':
        raise ValueError('v2 summary requires passing SVG fidelity evidence')
    output['interpretation'] = 'Corrected-renderer replication uses fresh boards from previously exposed source families; it is not blind independent source-family validation.'
    provenance = read('regression-provenance.json')
    if provenance['freezeFileSha256'] != freeze['freezeFileSha256']:
        raise ValueError('Regression provenance does not bind the candidate freeze')
    for browser in ('chromium', 'firefox', 'webkit'):
        rows = {}
        for candidate_id, identity in candidates.items():
            for role, count in (('print-held-out-v2', 256), ('corpus-v1-regression', 14)):
                report = read(f'browser-{browser}-{candidate_id}-{role}.json')
                summary = report['summary']
                if (report['candidate']['id'] != candidate_id or report['candidate']['seed'] != identity['seed'] or
                    report['candidate']['modelSha256'] != identity['sha256'] or
                    report['freeze']['protocolSha256'] != output['protocolSha256'] or
                    report['freeze']['testManifestSha256'] != freeze['testManifestSha256'] or
                    report['environment']['browser']['name'] != browser or
                    report['contract']['reliabilityFloor'] != protocol['confidenceFloor'] or
                    report['nonSameOriginRequests'] or summary['totalBoards'] != count or
                    summary['totalSquares'] != count * 64 or len(report['observations']) != count or
                    sum(map(sum, summary['confusion'])) != count * 64 or
                    len(report['rawTiming']['fullPassInferenceMs']) != count):
                    raise ValueError('Incomplete or inconsistent browser evidence')
                if role == 'corpus-v1-regression' and report['vectors']['sha256'] != provenance['vectorsSha256']:
                    raise ValueError('Regression vectors differ from retained preprocessing provenance')
                rows[(candidate_id, role)] = report
            faults = read(f'browser-faults-{browser}-{candidate_id}.json')
            if (faults['candidate']['sha256'] != identity['sha256'] or faults['nonSameOriginRequests'] or
                not all(faults[key]['passed'] for key in ('cancellation', 'timeoutTerminationAndRecovery',
                    'modelIntegrityFailureBeforeInference', 'warmOfflineInference'))):
                raise ValueError('Browser fault/privacy gate failed')
        for candidate_id in candidates:
            test = rows[(candidate_id, 'print-held-out-v2')]
            regression = rows[(candidate_id, 'corpus-v1-regression')]
            control = rows[('shipped', 'corpus-v1-regression')]
            if test['vectors']['sha256'] != rows[('shipped', 'print-held-out-v2')]['vectors']['sha256'] or regression['vectors']['sha256'] != control['vectors']['sha256']:
                raise ValueError('Candidates did not receive identical vectors')
            checks = promotion(test['summary'], regression['summary'], control['summary'], protocol['promotion'])
            output['candidates'].append({'browser': browser, 'candidate': candidate_id,
                'eligible': all(checks.values()), 'promotionChecks': checks,
                'heldOut': test['summary'], 'heldOutStratified': stratified_test_metrics(test, render_by_board), 'regression': regression['summary'],
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
