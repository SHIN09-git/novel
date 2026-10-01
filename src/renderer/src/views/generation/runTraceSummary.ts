import type { ConsistencyReviewReport, GenerationRunTrace, QualityGateReport } from '../../../../shared/types'

export function buildRunTraceSummary(
  trace: GenerationRunTrace,
  consistencyReport: ConsistencyReviewReport | null,
  qualityReport: QualityGateReport | null
) {
  const composition = trace.promptCompositionMetrics
  return {
    id: trace.id,
    jobId: trace.jobId,
    targetChapterOrder: trace.targetChapterOrder,
    contextSource: trace.contextSource,
    promptContextSnapshotId: trace.promptContextSnapshotId,
    pipelineRecipeId: trace.pipelineRecipeId,
    pipelineRecipeVersion: trace.pipelineRecipeVersion,
    pipelineRecipeExplanation: trace.pipelineRecipeExplanation,
    aiCalls: trace.aiCalls ?? [],
    selectedCounts: {
      chapters: trace.selectedChapterIds.length,
      stageSummaries: trace.selectedStageSummaryIds.length,
      characters: trace.selectedCharacterIds.length,
      foreshadowings: trace.selectedForeshadowingIds.length
    },
    foreshadowingTreatmentModes: trace.foreshadowingTreatmentModes,
    foreshadowingTreatmentOverrides: trace.foreshadowingTreatmentOverrides,
    omittedContextItems: trace.omittedContextItems,
    contextWarnings: trace.contextWarnings,
    contextNeedPlanId: trace.contextNeedPlanId,
    storyDirectionGuideId: trace.storyDirectionGuideId,
    storyDirectionGuideSource: trace.storyDirectionGuideSource,
    storyDirectionGuideHorizon: trace.storyDirectionGuideHorizon,
    storyDirectionBeatId: trace.storyDirectionBeatId,
    storyDirectionAppliedToChapterTask: trace.storyDirectionAppliedToChapterTask,
    hardCanonPackItemCount: trace.hardCanonPackItemCount,
    hardCanonPackTokenEstimate: trace.hardCanonPackTokenEstimate,
    includedHardCanonItemIds: trace.includedHardCanonItemIds,
    truncatedHardCanonItemIds: trace.truncatedHardCanonItemIds,
    contextNeedPlanWarnings: trace.contextNeedPlanWarnings,
    contextNeedPlanMatchedItems: trace.contextNeedPlanMatchedItems,
    contextNeedPlanOmittedItems: trace.contextNeedPlanOmittedItems,
    includedCharacterStateFactIds: trace.includedCharacterStateFactIds,
    characterStateWarnings: trace.characterStateWarnings,
    characterStateIssueIds: trace.characterStateIssueIds,
    noveltyAuditResult: trace.noveltyAuditResult,
    contextTokenEstimate: trace.contextTokenEstimate,
    forcedContextBlocks: trace.forcedContextBlocks,
    compressionRecords: trace.compressionRecords,
    promptBlockOrder: trace.promptBlockOrder,
    finalPromptTokenEstimate: trace.finalPromptTokenEstimate,
    promptCompositionMetrics: composition
      ? {
          totalTokenEstimate: composition.totalTokenEstimate,
          attributedTokenEstimate: composition.attributedTokenEstimate,
          unattributedTokenEstimate: composition.unattributedTokenEstimate,
          categoryTokenEstimates: composition.categoryTokenEstimates,
          categoryShares: composition.categoryShares,
          blockMetrics: composition.blockMetrics,
          constraintLineCount: composition.constraintLineCount,
          reviewToneLineCount: composition.reviewToneLineCount,
          alertCounts: {
            repeatedSentences: composition.repeatedSentences.length,
            similarConstraints: composition.similarConstraints.length
          },
          summary: composition.summary
        }
      : null,
    generatedDraftId: trace.generatedDraftId,
    continuityBridgeId: trace.continuityBridgeId,
    continuitySource: trace.continuitySource,
    continuityWarnings: trace.continuityWarnings,
    redundancyReportId: trace.redundancyReportId,
    consistencyReviewReportId: trace.consistencyReviewReportId,
    qualityGateReportId: trace.qualityGateReportId,
    issueCounts: {
      consistencyHigh: consistencyReport?.issues.filter((issue) => issue.severity === 'high').length ?? 0,
      consistencyMedium: consistencyReport?.issues.filter((issue) => issue.severity === 'medium').length ?? 0,
      consistencyLow: consistencyReport?.issues.filter((issue) => issue.severity === 'low').length ?? 0,
      qualityHigh: qualityReport?.issues.filter((issue) => issue.severity === 'high').length ?? 0,
      qualityMedium: qualityReport?.issues.filter((issue) => issue.severity === 'medium').length ?? 0,
      qualityLow: qualityReport?.issues.filter((issue) => issue.severity === 'low').length ?? 0
    },
    revisionSessionIds: trace.revisionSessionIds,
    acceptedRevisionVersionId: trace.acceptedRevisionVersionId,
    acceptedMemoryCandidateIds: trace.acceptedMemoryCandidateIds,
    rejectedMemoryCandidateIds: trace.rejectedMemoryCandidateIds,
    createdAt: trace.createdAt,
    updatedAt: trace.updatedAt
  }
}
