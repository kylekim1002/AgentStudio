import { registerWorkflow } from "../core/registry";
import { applyApprovalPolicy } from "../core/policy";
import { WorkflowDefinition } from "../core/types";
import { ApprovalRequiredError } from "../core/errors";
import { runLessonAgent } from "./runAgent";
import {
  AgentName,
  ApprovedPassageLockOutput,
  AssessmentOutput,
  DEFAULT_CONTENT_COUNTS,
  LessonPackage,
  LessonRequest,
  LessonWorkflowState,
  PassageGenerationOutput,
  PassageValidationOutput,
  PublisherMetaOutput,
  QAOutput,
  ReadingOutput,
  ResearchCurationOutput,
  SourceModeRouterOutput,
  TeachingFrameOutput,
  TopicSelectionOutput,
  VocabularyOutput,
  WritingOutput,
  GrammarOutput,
  DifficultyLockOutput,
  IntentRouterOutput,
  OnProgressCallback,
} from "./types";

export const LESSON_WORKFLOW_NAME = "lesson_generation";

export const lessonWorkflowDefinition: WorkflowDefinition<
  LessonRequest,
  LessonPackage,
  AgentName
> = {
  name: LESSON_WORKFLOW_NAME,
  approvalPolicies: [
    {
      id: "lesson-publish-review",
      step: AgentName.PUBLISHER,
      riskLevel: "review",
      shouldRequest: (request) => request.approvalMode === "require_review",
      buildApproval: ({ data }) => ({
        title: "레슨 발행 승인 필요",
        summary: `${(data as { lessonPackage: LessonPackage }).lessonPackage.title} 레슨 패키지를 최종 발행하기 전에 검토가 필요합니다.`,
      }),
      buildCheckpoint: ({ data }) => ({
        phase: "pre_publish",
        qa: (data as { qa: QAOutput }).qa,
        lessonPackage: (data as { lessonPackage: LessonPackage }).lessonPackage,
      }),
    },
  ],
  async run(request, runtime) {
    const state: LessonWorkflowState = {};

    state.intentRouter = await runtime.step<IntentRouterOutput>(
      AgentName.INTENT_ROUTER,
      () => runLessonAgent(AgentName.INTENT_ROUTER, request.provider, { userInput: request.userInput })
    );

    state.teachingFrame = await runtime.step<TeachingFrameOutput>(
      AgentName.TEACHING_FRAME,
      () =>
        runLessonAgent(AgentName.TEACHING_FRAME, request.provider, {
          intentRouter: state.intentRouter,
          userInput: request.userInput,
        })
    );

    state.difficultyLock = await runtime.step<DifficultyLockOutput>(
      AgentName.DIFFICULTY_LOCK,
      () =>
        runLessonAgent(AgentName.DIFFICULTY_LOCK, request.provider, {
          teachingFrame: state.teachingFrame,
          requestedDifficulty: request.difficulty,
        })
    );

    state.sourceModeRouter = await runtime.step<SourceModeRouterOutput>(
      AgentName.SOURCE_MODE_ROUTER,
      () =>
        runLessonAgent(AgentName.SOURCE_MODE_ROUTER, request.provider, {
          intentRouter: state.intentRouter,
          providedPassage: request.providedPassage,
        })
    );

    if (state.sourceModeRouter.mode === "topic") {
      state.topicSelection = await runtime.step<TopicSelectionOutput>(
        AgentName.TOPIC_SELECTION,
        () =>
          runLessonAgent(AgentName.TOPIC_SELECTION, request.provider, {
            teachingFrame: state.teachingFrame,
            difficultyLock: state.difficultyLock,
            userInput: request.userInput,
          })
      );
    } else {
      runtime.emit({ step: AgentName.TOPIC_SELECTION, status: "skipped" });
    }

    if (state.sourceModeRouter.mode === "topic" && state.topicSelection) {
      state.researchCuration = await runtime.step<ResearchCurationOutput>(
        AgentName.RESEARCH_CURATION,
        () =>
          runLessonAgent(AgentName.RESEARCH_CURATION, request.provider, {
            topicSelection: state.topicSelection,
          })
      );
    } else {
      runtime.emit({ step: AgentName.RESEARCH_CURATION, status: "skipped" });
    }

    state.passageGeneration = await runtime.step<PassageGenerationOutput>(
      AgentName.PASSAGE_GENERATION,
      () =>
        runLessonAgent(AgentName.PASSAGE_GENERATION, request.provider, {
          mode: state.sourceModeRouter?.mode,
          providedPassage: state.sourceModeRouter?.providedPassage,
          topicSelection: state.topicSelection,
          researchCuration: state.researchCuration,
          difficultyLock: state.difficultyLock,
          teachingFrame: state.teachingFrame,
        })
    );

    state.passageValidation = await runtime.step<PassageValidationOutput>(
      AgentName.PASSAGE_VALIDATION,
      () =>
        runLessonAgent(AgentName.PASSAGE_VALIDATION, request.provider, {
          passage: state.passageGeneration,
          difficultyLock: state.difficultyLock,
        })
    );

    if (!state.passageValidation.approved) {
      throw new Error(
        `Passage validation failed: ${state.passageValidation.issues.join(", ")}`
      );
    }

    state.approvedPassageLock = await runtime.step<ApprovedPassageLockOutput>(
      AgentName.APPROVED_PASSAGE_LOCK,
      () =>
        runLessonAgent(AgentName.APPROVED_PASSAGE_LOCK, request.provider, {
          passageGeneration: state.passageGeneration,
        })
    );

    runtime.emit({ step: AgentName.READING, status: "running" });
    runtime.emit({ step: AgentName.VOCABULARY, status: "running" });
    runtime.emit({ step: AgentName.GRAMMAR, status: "running" });
    runtime.emit({ step: AgentName.WRITING, status: "running" });
    runtime.emit({ step: AgentName.ASSESSMENT, status: "running" });

    const lockedContext = {
      passage: state.approvedPassageLock,
      difficultyLock: state.difficultyLock,
      teachingFrame: state.teachingFrame,
    };

    const counts = {
      reading: request.contentCounts?.reading ?? DEFAULT_CONTENT_COUNTS.reading,
      vocabulary: request.contentCounts?.vocabulary ?? DEFAULT_CONTENT_COUNTS.vocabulary,
      assessment: request.contentCounts?.assessment ?? DEFAULT_CONTENT_COUNTS.assessment,
      grammarExercises: request.contentCounts?.grammarExercises ?? DEFAULT_CONTENT_COUNTS.grammarExercises,
    };

    const [reading, vocabulary, grammar, writing, assessment] = await Promise.all([
      runLessonAgent<ReadingOutput>(AgentName.READING, request.provider, { ...lockedContext, targetCount: counts.reading }),
      runLessonAgent<VocabularyOutput>(AgentName.VOCABULARY, request.provider, { ...lockedContext, targetCount: counts.vocabulary }),
      runLessonAgent<GrammarOutput>(AgentName.GRAMMAR, request.provider, { ...lockedContext, targetCount: counts.grammarExercises }),
      runLessonAgent<WritingOutput>(AgentName.WRITING, request.provider, lockedContext),
      runLessonAgent<AssessmentOutput>(AgentName.ASSESSMENT, request.provider, { ...lockedContext, targetCount: counts.assessment }),
    ]);

    state.reading = reading;
    state.vocabulary = vocabulary;
    state.grammar = grammar;
    state.writing = writing;
    state.assessment = assessment;

    runtime.emit({ step: AgentName.READING, status: "done", output: reading });
    runtime.emit({ step: AgentName.VOCABULARY, status: "done", output: vocabulary });
    runtime.emit({ step: AgentName.GRAMMAR, status: "done", output: grammar });
    runtime.emit({ step: AgentName.WRITING, status: "done", output: writing });
    runtime.emit({ step: AgentName.ASSESSMENT, status: "done", output: assessment });

    state.qa = await runtime.step<QAOutput>(AgentName.QA, () =>
      runLessonAgent(AgentName.QA, request.provider, {
        passage: state.approvedPassageLock,
        reading: state.reading,
        vocabulary: state.vocabulary,
        grammar: state.grammar,
        writing: state.writing,
        assessment: state.assessment,
        difficultyLock: state.difficultyLock,
      })
    );

    if (!state.qa.approvedForPublish) {
      throw new Error(
        `QA failed (score: ${state.qa.overallScore}): ${state.qa.issues.join(", ")}`
      );
    }

    const lessonPackage: LessonPackage = {
      title: state.approvedPassageLock.title,
      difficulty: state.difficultyLock.difficulty,
      passage: state.approvedPassageLock.passage,
      wordCount: state.approvedPassageLock.wordCount,
      reading: state.reading,
      vocabulary: state.vocabulary,
      grammar: state.grammar,
      writing: state.writing,
      assessment: state.assessment,
    };

    await applyApprovalPolicy(lessonWorkflowDefinition, runtime, {
      request,
      step: AgentName.PUBLISHER,
      data: {
        qa: state.qa,
        lessonPackage,
      },
    });

    const publisherMeta = await runtime.step<PublisherMetaOutput>(
      AgentName.PUBLISHER,
      () => runLessonAgent(AgentName.PUBLISHER, request.provider, { qa: state.qa })
    );

    state.publisher = {
      ...publisherMeta,
      package: lessonPackage,
    };

    return state.publisher.package;
  },
  async resume(request, runtime, checkpoint) {
    const resumePoint = checkpoint as
      | {
          phase?: "pre_publish";
          qa?: QAOutput;
          lessonPackage?: LessonPackage;
        }
      | undefined;

    if (resumePoint?.phase !== "pre_publish" || !resumePoint.qa || !resumePoint.lessonPackage) {
      throw new Error("No resumable lesson checkpoint found");
    }

    await runtime.step<PublisherMetaOutput>(AgentName.PUBLISHER, () =>
      runLessonAgent(AgentName.PUBLISHER, request.provider, { qa: resumePoint.qa })
    );
    runtime.setCheckpoint(undefined);

    return resumePoint.lessonPackage;
  },
};

registerWorkflow(lessonWorkflowDefinition);

export async function runLessonWorkflow(
  request: LessonRequest,
  onProgress: OnProgressCallback
): Promise<LessonPackage> {
  return lessonWorkflowDefinition.run(request, {
    workflow: lessonWorkflowDefinition.name,
    emit(progress) {
      onProgress({
        workflow: lessonWorkflowDefinition.name,
        step: progress.step,
        status: progress.status,
        output: progress.output,
        error: progress.error,
      });
    },
    async step(stepName, run) {
      onProgress({
        workflow: lessonWorkflowDefinition.name,
        step: stepName,
        status: "running",
      });
      try {
        const output = await run();
        onProgress({
          workflow: lessonWorkflowDefinition.name,
          step: stepName,
          status: "done",
          output,
        });
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onProgress({
          workflow: lessonWorkflowDefinition.name,
          step: stepName,
          status: "error",
          error: message,
        });
        throw error;
      }
    },
    setCheckpoint() {},
    async requestApproval(params) {
      throw new ApprovalRequiredError({
        approvalId: "local-approval",
        executionId: "local-execution",
        workflow: lessonWorkflowDefinition.name,
        message: `${params.title}: ${params.summary}`,
      });
    },
  });
}
