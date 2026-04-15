import { registerWorkflow } from "../core/registry";
import { applyApprovalPolicy } from "../core/policy";
import { WorkflowDefinition } from "../core/types";
import { ApprovalRequiredError } from "../core/errors";
import { runLessonAgent } from "./runAgent";
import {
  AgentName,
  ApprovedPassageLockOutput,
  AssessmentOutput,
  ContentCheckpoint,
  ContentReviewResult,
  PassageCheckpoint,
  DEFAULT_CONTENT_COUNTS,
  LessonPackage,
  LessonRequest,
  LessonWorkflowState,
  PassageReviewResult,
  PassageGenerationOutput,
  PassageValidationOutput,
  PublisherMetaOutput,
  QAOutput,
  ReadingOutput,
  ResearchCurationOutput,
  SourceMode,
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

function countPassageWords(text: string) {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;
}

function countPassageParagraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean).length;
}

function normalizePassageGenerationOutput(
  passage: PassageGenerationOutput,
  difficulty: DifficultyLockOutput["difficulty"]
): PassageGenerationOutput {
  return {
    ...passage,
    difficulty,
    wordCount: countPassageWords(passage.passage),
  };
}

function reconcilePassageValidation(
  validation: PassageValidationOutput,
  passage: PassageGenerationOutput,
  difficultyLock: DifficultyLockOutput
): PassageValidationOutput {
  const issues: string[] = [];
  const suggestions = [...validation.suggestions];
  const lowerBound = Math.round(difficultyLock.wordCountTarget * 0.9);
  const upperBound = Math.round(difficultyLock.wordCountTarget * 1.1);
  const paragraphCount = countPassageParagraphs(passage.passage);

  if (passage.wordCount < lowerBound || passage.wordCount > upperBound) {
    issues.push(
      `Word count is outside the target range: target is ${difficultyLock.wordCountTarget}, acceptable range is ${lowerBound} to ${upperBound}, but passage has ${passage.wordCount} words.`
    );
    suggestions.push(
      `Adjust the passage length to stay within ${lowerBound}-${upperBound} words.`
    );
  }

  if (paragraphCount < 2) {
    issues.push("Passage structure needs to be clearly divided into at least 2 paragraphs.");
    suggestions.push("Break the passage into at least two natural paragraphs with a blank line between them.");
  }

  const filteredModelIssues = validation.issues.filter((issue) => {
    const normalized = issue.toLowerCase();
    const isWordCountIssue =
      normalized.includes("word count") ||
      normalized.includes("target range") ||
      normalized.includes("acceptable range");
    const isParagraphIssue =
      normalized.includes("paragraph") ||
      normalized.includes("single block");

    if (isWordCountIssue) {
      return passage.wordCount < lowerBound || passage.wordCount > upperBound;
    }

    if (isParagraphIssue) {
      return paragraphCount < 2;
    }

    return true;
  });

  const dedupedIssues = Array.from(new Set([...issues, ...filteredModelIssues]));
  const dedupedSuggestions = Array.from(new Set(suggestions));

  return {
    approved: dedupedIssues.length === 0,
    issues: dedupedIssues,
    suggestions: dedupedSuggestions,
  };
}

function buildPassageRevisionInstruction(validation: PassageValidationOutput) {
  const issueText = validation.issues.length
    ? `Validation issues: ${validation.issues.join(" ")}`
    : "";
  const suggestionText = validation.suggestions.length
    ? `Suggestions: ${validation.suggestions.join(" ")}`
    : "";

  return [
    "Revise the passage so it passes validation.",
    "Keep one dominant focus only and make sure the title matches that focus.",
    issueText,
    suggestionText,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeAssessmentOutput(assessment: AssessmentOutput): AssessmentOutput {
  const normalizedQuestions = assessment.questions.map((question) => ({
    ...question,
    points: Math.max(0, Math.floor(question.points || 0)),
  }));
  const totalPoints = normalizedQuestions.reduce((sum, question) => sum + question.points, 0);
  return {
    ...assessment,
    questions: normalizedQuestions,
    totalPoints,
    passingScore: Math.min(totalPoints, Math.max(0, Math.floor(totalPoints * 0.7))),
  };
}

function normalizeIssueText(issue: string) {
  return issue.toLowerCase();
}

function isAssessmentScoreIssue(issue: string) {
  const normalized = normalizeIssueText(issue);
  return (
    (normalized.includes("assessment") || normalized.includes("totalpoints") || normalized.includes("passingscore")) &&
    (normalized.includes("sum of the question points") ||
      normalized.includes("totalpoints do not match") ||
      normalized.includes("passingscore is incorrect") ||
      normalized.includes("should be"))
  );
}

function isPassageWordCountIssue(issue: string) {
  const normalized = normalizeIssueText(issue);
  return normalized.includes("passage word count") || normalized.includes("word count exceeds");
}

function isAssessmentDuplicationIssue(issue: string) {
  const normalized = normalizeIssueText(issue);
  return [
    normalized.includes("duplicate") && normalized.includes("reading questions"),
    normalized.includes("duplicat") && normalized.includes("reading"),
    normalized.includes("near-copy") && normalized.includes("reading"),
    normalized.includes("too similar") && normalized.includes("reading"),
    normalized.includes("same as") && normalized.includes("reading"),
    normalized.includes("overlap") && normalized.includes("reading"),
    normalized.includes("comprehension items"),
  ].some(Boolean);
}

function reconcileQAOutput(
  qa: QAOutput,
  params: {
    passage: ApprovedPassageLockOutput;
    difficultyLock: DifficultyLockOutput;
    assessment: AssessmentOutput;
  }
): QAOutput {
  const lowerBound = Math.round(params.difficultyLock.wordCountTarget * 0.9);
  const upperBound = Math.round(params.difficultyLock.wordCountTarget * 1.1);
  const actualWordCount = countPassageWords(params.passage.passage);
  const actualTotalPoints = params.assessment.questions.reduce((sum, question) => sum + question.points, 0);
  const actualPassingScore = Math.min(
    actualTotalPoints,
    Math.max(0, Math.floor(actualTotalPoints * 0.7))
  );

  const filteredIssues = qa.issues.filter((issue) => {
    if (isPassageWordCountIssue(issue)) {
      return actualWordCount < lowerBound || actualWordCount > upperBound;
    }

    if (isAssessmentScoreIssue(issue)) {
      return (
        params.assessment.totalPoints !== actualTotalPoints ||
        params.assessment.passingScore !== actualPassingScore
      );
    }

    return true;
  });

  const removedIssueCount = Math.max(0, qa.issues.length - filteredIssues.length);
  const estimatedPassedItems = Math.max(0, Math.min(11, Math.round((qa.overallScore / 100) * 11)));
  const adjustedPassedItems = Math.max(
    0,
    Math.min(11, estimatedPassedItems + removedIssueCount)
  );
  const adjustedOverallScore = Math.round((adjustedPassedItems / 11) * 100);

  if (filteredIssues.length === 0) {
    return {
      ...qa,
      passed: true,
      issues: [],
      overallScore: 100,
      approvedForPublish: true,
    };
  }

  return {
    ...qa,
    issues: filteredIssues,
    passed: filteredIssues.length === 0,
    overallScore: Math.max(qa.overallScore, adjustedOverallScore),
    approvedForPublish: filteredIssues.length === 0 ? true : Math.max(qa.overallScore, adjustedOverallScore) >= 80,
  };
}

function buildAssessmentRevisionInstruction(issues: string[]) {
  return [
    "Revise the assessment so it passes QA.",
    "Do not rephrase or copy the reading questions.",
    "Use different angles such as application, synthesis, transfer, or vocabulary recall.",
    "Recalculate totalPoints from the actual question points and set passingScore to floor(totalPoints * 0.7).",
    `QA issues: ${issues.join(" ")}`,
  ].join(" ");
}

function normalizeWritingOutput(writing: WritingOutput, targetCount: number): WritingOutput {
  const rawTasks =
    Array.isArray(writing.tasks) && writing.tasks.length > 0
      ? writing.tasks
      : [
          {
            prompt: writing.prompt,
            scaffolding: writing.scaffolding,
            rubric: writing.rubric,
            modelAnswer: writing.modelAnswer,
          },
        ];

  const normalizedTasks = rawTasks
    .slice(0, Math.max(1, targetCount))
    .map((task) => ({
      prompt: task.prompt ?? "",
      scaffolding: Array.isArray(task.scaffolding) ? task.scaffolding : [],
      rubric: Array.isArray(task.rubric) ? task.rubric : [],
      modelAnswer: task.modelAnswer ?? "",
    }))
    .filter((task) => task.prompt.trim());

  const fallbackTask = normalizedTasks[0] ?? {
    prompt: writing.prompt ?? "",
    scaffolding: Array.isArray(writing.scaffolding) ? writing.scaffolding : [],
    rubric: Array.isArray(writing.rubric) ? writing.rubric : [],
    modelAnswer: writing.modelAnswer ?? "",
  };

  return {
    prompt: fallbackTask.prompt,
    scaffolding: fallbackTask.scaffolding,
    rubric: fallbackTask.rubric,
    modelAnswer: fallbackTask.modelAnswer,
    tasks: normalizedTasks.length > 0 ? normalizedTasks : [fallbackTask],
  };
}

export const lessonWorkflowDefinition: WorkflowDefinition<
  LessonRequest,
  LessonPackage | PassageReviewResult | ContentReviewResult,
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

    const callAgent = <T>(name: AgentName, input: unknown): Promise<T> =>
      runLessonAgent<T>(name, request.provider, input, request.apiKeys);

    const generateValidatedPassage = async (params: {
      mode: SourceMode | undefined;
      providedPassage?: string;
      topicSelection?: TopicSelectionOutput;
      researchCuration?: ResearchCurationOutput;
      difficultyLock: DifficultyLockOutput;
      teachingFrame: TeachingFrameOutput;
      allowRetry?: boolean;
    }) => {
      const runGeneration = async (revisionInstruction?: string) =>
        normalizePassageGenerationOutput(
          await runtime.step<PassageGenerationOutput>(
            AgentName.PASSAGE_GENERATION,
            () =>
              callAgent(AgentName.PASSAGE_GENERATION, {
                mode: params.mode,
                providedPassage: params.providedPassage,
                topicSelection: params.topicSelection,
                researchCuration: params.researchCuration,
                difficultyLock: params.difficultyLock,
                teachingFrame: params.teachingFrame,
                ...(revisionInstruction ? { revisionInstruction } : {}),
              })
          ),
          params.difficultyLock.difficulty
        );

      const runValidation = async (passage: PassageGenerationOutput) => {
        const rawValidation = await runtime.step<PassageValidationOutput>(
          AgentName.PASSAGE_VALIDATION,
          () =>
            callAgent(AgentName.PASSAGE_VALIDATION, {
              passage,
              difficultyLock: params.difficultyLock,
            })
        );

        return reconcilePassageValidation(rawValidation, passage, params.difficultyLock);
      };

      let passage = await runGeneration();
      let validation = await runValidation(passage);

      if (!validation.approved && params.allowRetry !== false) {
        const revisionInstruction = buildPassageRevisionInstruction(validation);
        passage = await runGeneration(revisionInstruction);
        validation = await runValidation(passage);
      }

      return { passage, validation };
    };

    const runContentStage = async () => {
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
        writing: request.contentCounts?.writing ?? DEFAULT_CONTENT_COUNTS.writing,
      };

      const regenerateAgents = new Set(request.regenerateAgents ?? []);
      const revisionInstructions = request.revisionInstructions ?? {};

      const getAgentInput = (agent: AgentName) => ({
        ...lockedContext,
        ...(agent === AgentName.READING ? { targetCount: counts.reading } : {}),
        ...(agent === AgentName.VOCABULARY ? { targetCount: counts.vocabulary } : {}),
        ...(agent === AgentName.GRAMMAR ? { targetCount: counts.grammarExercises } : {}),
        ...(agent === AgentName.WRITING ? { targetCount: counts.writing } : {}),
        ...(agent === AgentName.ASSESSMENT ? { targetCount: counts.assessment } : {}),
        ...(revisionInstructions[agent]
          ? {
              revisionInstruction: revisionInstructions[agent],
            }
          : {}),
      });

      const readExistingOrRun = async <T>(
        agent: AgentName,
        existingOutput: T | undefined
      ): Promise<T> => {
        if (
          request.contentCheckpoint &&
          existingOutput !== undefined &&
          !regenerateAgents.has(agent)
        ) {
          runtime.emit({
            step: agent,
            status: "done",
            output: existingOutput,
          });
          return existingOutput;
        }

        return runtime.step<T>(agent, () => callAgent(agent, getAgentInput(agent)));
      };

      const [reading, vocabulary, grammar, writing, assessment] = await Promise.all([
        readExistingOrRun<ReadingOutput>(AgentName.READING, state.reading),
        readExistingOrRun<VocabularyOutput>(AgentName.VOCABULARY, state.vocabulary),
        readExistingOrRun<GrammarOutput>(AgentName.GRAMMAR, state.grammar),
        readExistingOrRun<WritingOutput>(AgentName.WRITING, state.writing),
        readExistingOrRun<AssessmentOutput>(AgentName.ASSESSMENT, state.assessment),
      ]);

      state.reading = reading;
      state.vocabulary = vocabulary;
      state.grammar = grammar;
      state.writing = normalizeWritingOutput(writing, counts.writing);
      state.assessment = normalizeAssessmentOutput(assessment);
    };

    if (request.passageCheckpoint) {
      state.difficultyLock = request.passageCheckpoint.difficultyLock;
      state.teachingFrame = request.passageCheckpoint.teachingFrame;

      runtime.emit({
        step: AgentName.INTENT_ROUTER,
        status: "skipped",
      });
      runtime.emit({
        step: AgentName.TEACHING_FRAME,
        status: "skipped",
      });
      runtime.emit({
        step: AgentName.DIFFICULTY_LOCK,
        status: "skipped",
      });
      runtime.emit({
        step: AgentName.SOURCE_MODE_ROUTER,
        status: "skipped",
      });
      runtime.emit({
        step: AgentName.TOPIC_SELECTION,
        status: "skipped",
      });
      runtime.emit({
        step: AgentName.RESEARCH_CURATION,
        status: "skipped",
      });

      if (request.passageCheckpoint.needsRevalidation) {
        state.passageGeneration = normalizePassageGenerationOutput(
          {
            passage: request.passageCheckpoint.approvedPassageLock.passage,
            title: request.passageCheckpoint.approvedPassageLock.title,
            wordCount: request.passageCheckpoint.approvedPassageLock.wordCount,
            difficulty: request.passageCheckpoint.difficultyLock.difficulty,
          },
          request.passageCheckpoint.difficultyLock.difficulty
        );

        runtime.emit({
          step: AgentName.PASSAGE_GENERATION,
          status: "done",
          output: state.passageGeneration,
        });

        state.passageValidation = await (async () => {
          const rawValidation = await runtime.step<PassageValidationOutput>(
            AgentName.PASSAGE_VALIDATION,
            () =>
              callAgent(AgentName.PASSAGE_VALIDATION, {
                passage: state.passageGeneration,
                difficultyLock: state.difficultyLock,
              })
          );
          return reconcilePassageValidation(
            rawValidation,
            state.passageGeneration!,
            state.difficultyLock!
          );
        })();

        if (!state.passageValidation.approved) {
          throw new Error(
            `Passage validation failed: ${state.passageValidation.issues.join(", ")}`
          );
        }

        state.approvedPassageLock = await runtime.step<ApprovedPassageLockOutput>(
          AgentName.APPROVED_PASSAGE_LOCK,
          () =>
            callAgent(AgentName.APPROVED_PASSAGE_LOCK, {
              passageGeneration: state.passageGeneration,
            })
        );
      } else {
        state.approvedPassageLock = request.passageCheckpoint.approvedPassageLock;
        runtime.emit({
          step: AgentName.PASSAGE_GENERATION,
          status: "skipped",
        });
        runtime.emit({
          step: AgentName.PASSAGE_VALIDATION,
          status: "skipped",
        });
        runtime.emit({
          step: AgentName.APPROVED_PASSAGE_LOCK,
          status: "done",
          output: state.approvedPassageLock,
        });
      }
    } else if (request.contentCheckpoint) {
      state.approvedPassageLock = request.contentCheckpoint.approvedPassageLock;
      state.difficultyLock = request.contentCheckpoint.difficultyLock;
      state.teachingFrame = request.contentCheckpoint.teachingFrame;
      state.reading = request.contentCheckpoint.reading;
      state.vocabulary = request.contentCheckpoint.vocabulary;
      state.grammar = request.contentCheckpoint.grammar;
      state.writing = normalizeWritingOutput(
        request.contentCheckpoint.writing,
        request.contentCounts?.writing ?? DEFAULT_CONTENT_COUNTS.writing
      );
      state.assessment = normalizeAssessmentOutput(request.contentCheckpoint.assessment);

      runtime.emit({ step: AgentName.INTENT_ROUTER, status: "skipped" });
      runtime.emit({ step: AgentName.TEACHING_FRAME, status: "skipped" });
      runtime.emit({ step: AgentName.DIFFICULTY_LOCK, status: "skipped" });
      runtime.emit({ step: AgentName.SOURCE_MODE_ROUTER, status: "skipped" });
      runtime.emit({ step: AgentName.TOPIC_SELECTION, status: "skipped" });
      runtime.emit({ step: AgentName.RESEARCH_CURATION, status: "skipped" });
      runtime.emit({ step: AgentName.PASSAGE_GENERATION, status: "skipped" });
      runtime.emit({ step: AgentName.PASSAGE_VALIDATION, status: "skipped" });
      runtime.emit({
        step: AgentName.APPROVED_PASSAGE_LOCK,
        status: "done",
        output: state.approvedPassageLock,
      });
    } else {
      state.intentRouter = await runtime.step<IntentRouterOutput>(
        AgentName.INTENT_ROUTER,
        () => callAgent(AgentName.INTENT_ROUTER, { userInput: request.userInput })
      );

      state.teachingFrame = await runtime.step<TeachingFrameOutput>(
        AgentName.TEACHING_FRAME,
        () =>
          callAgent(AgentName.TEACHING_FRAME, {
            intentRouter: state.intentRouter,
            userInput: request.userInput,
          })
      );

      state.difficultyLock = await runtime.step<DifficultyLockOutput>(
        AgentName.DIFFICULTY_LOCK,
        () =>
          callAgent(AgentName.DIFFICULTY_LOCK, {
            teachingFrame: state.teachingFrame,
            requestedDifficulty: request.difficulty,
          })
      );

      state.sourceModeRouter = await runtime.step<SourceModeRouterOutput>(
        AgentName.SOURCE_MODE_ROUTER,
        () =>
          callAgent(AgentName.SOURCE_MODE_ROUTER, {
            intentRouter: state.intentRouter,
            providedPassage: request.providedPassage,
          })
      );

      if (state.sourceModeRouter.mode === "topic") {
        state.topicSelection = await runtime.step<TopicSelectionOutput>(
          AgentName.TOPIC_SELECTION,
          () =>
            callAgent(AgentName.TOPIC_SELECTION, {
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
            callAgent(AgentName.RESEARCH_CURATION, {
              topicSelection: state.topicSelection,
            })
        );
      } else {
        runtime.emit({ step: AgentName.RESEARCH_CURATION, status: "skipped" });
      }

      const passageStage = await generateValidatedPassage({
        mode: state.sourceModeRouter?.mode,
        providedPassage: state.sourceModeRouter?.providedPassage,
        topicSelection: state.topicSelection,
        researchCuration: state.researchCuration,
        difficultyLock: state.difficultyLock,
        teachingFrame: state.teachingFrame,
      });
      state.passageGeneration = passageStage.passage;
      state.passageValidation = passageStage.validation;

      if (!state.passageValidation.approved) {
        throw new Error(
          `Passage validation failed: ${state.passageValidation.issues.join(", ")}`
        );
      }

      state.approvedPassageLock = await runtime.step<ApprovedPassageLockOutput>(
        AgentName.APPROVED_PASSAGE_LOCK,
        () =>
          callAgent(AgentName.APPROVED_PASSAGE_LOCK, {
            passageGeneration: state.passageGeneration,
          })
      );
    }

    if (
      (request.generationTarget === "passage_review" ||
        (request.generationTarget === "passage_and_content_review" &&
          !request.passageCheckpoint &&
          !request.contentCheckpoint)) &&
      state.approvedPassageLock &&
      state.difficultyLock &&
      state.teachingFrame
    ) {
      const checkpoint: PassageCheckpoint = {
        approvedPassageLock: state.approvedPassageLock,
        difficultyLock: state.difficultyLock,
        teachingFrame: state.teachingFrame,
      };

      return {
        kind: "passage_review",
        checkpoint,
      };
    }

    await runContentStage();

    if (
      request.generationTarget === "content_review" ||
      request.generationTarget === "passage_and_content_review"
    ) {
      const checkpoint: ContentCheckpoint = {
        approvedPassageLock: state.approvedPassageLock!,
        difficultyLock: state.difficultyLock!,
        teachingFrame: state.teachingFrame!,
        reading: state.reading!,
        vocabulary: state.vocabulary!,
        grammar: state.grammar!,
        writing: state.writing!,
        assessment: state.assessment!,
      };

      return {
        kind: "content_review",
        checkpoint,
      };
    }

    const runQA = async () =>
      reconcileQAOutput(
        await runtime.step<QAOutput>(AgentName.QA, () =>
          callAgent(AgentName.QA, {
            passage: state.approvedPassageLock,
            reading: state.reading,
            vocabulary: state.vocabulary,
            grammar: state.grammar,
            writing: state.writing,
            assessment: state.assessment,
            difficultyLock: state.difficultyLock,
          })
        ),
        {
          passage: state.approvedPassageLock!,
          difficultyLock: state.difficultyLock!,
          assessment: state.assessment!,
        }
      );

    state.qa = await runQA();

    if (
      !state.qa.approvedForPublish &&
      state.qa.issues.some(isAssessmentDuplicationIssue)
    ) {
      const revisionInstruction = buildAssessmentRevisionInstruction(state.qa.issues);
      state.assessment = normalizeAssessmentOutput(
        await runtime.step<AssessmentOutput>(AgentName.ASSESSMENT, () =>
          callAgent(AgentName.ASSESSMENT, {
            passage: state.approvedPassageLock,
            difficultyLock: state.difficultyLock,
            teachingFrame: state.teachingFrame,
            targetCount: request.contentCounts?.assessment ?? DEFAULT_CONTENT_COUNTS.assessment,
            revisionInstruction,
          })
        )
      );

      state.qa = await runQA();
    }

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
      reading: state.reading!,
      vocabulary: state.vocabulary!,
      grammar: state.grammar!,
      writing: state.writing!,
      assessment: state.assessment!,
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
      () => callAgent(AgentName.PUBLISHER, { qa: state.qa })
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
      runLessonAgent(AgentName.PUBLISHER, request.provider, { qa: resumePoint.qa }, request.apiKeys)
    );
    runtime.setCheckpoint(undefined);

    return resumePoint.lessonPackage;
  },
};

registerWorkflow(lessonWorkflowDefinition);

export async function runLessonWorkflow(
  request: LessonRequest,
  onProgress: OnProgressCallback
): Promise<LessonPackage | PassageReviewResult | ContentReviewResult> {
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
