/** Evaluation-only adaptation to the existing single-selection study contract. */
import { rgbaToGray, resolveOrientation, type TileClassifier } from '@scoriiu/fenshot';
import { recognizeLocalized } from '../src/recognition/experimentalLocalization';
import { validateRegion, type RecognitionRegion } from '../src/recognition/pipeline';
import type { RecognitionOutcome } from '../src/study/contracts';

export async function runLocalizedSelection(
  region: RecognitionRegion,
  classify: TileClassifier,
): Promise<RecognitionOutcome> {
  validateRegion(region);
  const reads = await recognizeLocalized(
    rgbaToGray(region.data, region.width, region.height),
    classify,
  );
  // The existing editor represents one user-selected board. Never choose between
  // different boards by classifier confidence; ask for a less ambiguous selection.
  const read = reads[0];
  if (reads.length !== 1 || !read) return { kind: 'no-board' };
  return {
    kind: 'board',
    board: {
      placement: read.placement,
      confidences: read.confidences,
      minConfidence: read.minConfidence,
      meanConfidence: read.meanConfidence,
      reliable: read.minConfidence >= 0.7,
      corners: read.corners,
      proposedOrientation: resolveOrientation(read.placement).orientation,
    },
  };
}
