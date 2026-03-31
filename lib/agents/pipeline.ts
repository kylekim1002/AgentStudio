import { runAgent } from "./runAgent";
import {
  AgentName,
  LessonRequest,
  LessonPackage,
  PipelineState,
  OnProgressCallback,
  IntentRouterOutput,
  TeachingFrameOutput,
  DifficultyLockOutput,
  SourceModeRouterOutput,
  TopicSelectionOutput,
  ResearchCurationOutput,
  PassageGenerationOutput,
  PassageValidationOutput,
  ApprovedPassageLockOutput,
  ReadingOutput,
  VocabularyOutput,
  GrammarOutput,
  WritingOutput,
  AssessmentOutput,
  QAOutput,
  PublisherOutput,
} from "./types";

async function step<T>(
  name: AgentName,
  request: LessonRequest,
  input: unknown,
  onProgress: OnProgressCallback
): Promise<T> {
  onProgress({ agent: name, status: "running" });
  try {
    const output = await runAgent<T>(name, request.provider, input);
    onProgress({ agent: name, status: "done", output });
    return output;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress({ agent: name, status: "error", error });
    throw err;
  }
}

export async function runPipeline(
  request: LessonRequest,
  onProgress: OnProgressCallback
): Promise<LessonPackage> {
  const state: PipelineState = {};

  // 1. Intent Router
  state.intentRouter = await step<IntentRouterOutput>(
    AgentName.INTENT_ROUTER,
    request,
    { userInput: request.userInput },
    onProgress
  );

  // 2. Teaching Frame
  state.teachingFrame = await step<TeachingFrameOutput>(
    AgentName.TEACHING_FRAME,
    request,
    { intentRouter: state.intentRouter, userInput: request.userInput },
    onProgress
  );

  // 3. Difficulty Lock
  state.difficultyLock = await step<DifficultyLockOutput>(
    AgentName.DIFFICULTY_LOCK,
    request,
    {
      teachingFrame: state.teachingFrame,
      requestedDifficulty: request.difficulty,
    },
    onProgress
  );

  // 4. Source Mode Router
  state.sourceModeRouter = await step<SourceModeRouterOutput>(
    AgentName.SOURCE_MODE_ROUTER,
    request,
    {
      intentRouter: state.intentRouter,
      providedPassage: request.providedPassage,
    },
    onProgress
  );

  // 5. Topic Selection (조건부: topic 모드일 때만)
  if (state.sourceModeRouter.mode === "topic") {
    state.topicSelection = await step<TopicSelectionOutput>(
      AgentName.TOPIC_SELECTION,
      request,
      {
        teachingFrame: state.teachingFrame,
        difficultyLock: state.difficultyLock,
        userInput: request.userInput,
      },
      onProgress
    );
  } else {
    onProgress({ agent: AgentName.TOPIC_SELECTION, status: "skipped" });
  }

  // 6. Research Curation (조건부: topic 모드일 때만)
  if (state.sourceModeRouter.mode === "topic" && state.topicSelection) {
    state.researchCuration = await step<ResearchCurationOutput>(
      AgentName.RESEARCH_CURATION,
      request,
      { topicSelection: state.topicSelection },
      onProgress
    );
  } else {
    onProgress({ agent: AgentName.RESEARCH_CURATION, status: "skipped" });
  }

  // 7. Passage Generation
  state.passageGeneration = await step<PassageGenerationOutput>(
    AgentName.PASSAGE_GENERATION,
    request,
    {
      mode: state.sourceModeRouter.mode,
      providedPassage: state.sourceModeRouter.providedPassage,
      topicSelection: state.topicSelection,
      researchCuration: state.researchCuration,
      difficultyLock: state.difficultyLock,
      teachingFrame: state.teachingFrame,
    },
    onProgress
  );

  // 8. Passage Validation
  state.passageValidation = await step<PassageValidationOutput>(
    AgentName.PASSAGE_VALIDATION,
    request,
    {
      passage: state.passageGeneration,
      difficultyLock: state.difficultyLock,
    },
    onProgress
  );

  if (!state.passageValidation.approved) {
    throw new Error(
      `Passage validation failed: ${state.passageValidation.issues.join(", ")}`
    );
  }

  // 9. Approved Passage Lock
  state.approvedPassageLock = await step<ApprovedPassageLockOutput>(
    AgentName.APPROVED_PASSAGE_LOCK,
    request,
    { passageGeneration: state.passageGeneration },
    onProgress
  );

  // 10–14. Content Agents (병렬 실행)
  onProgress({ agent: AgentName.READING, status: "running" });
  onProgress({ agent: AgentName.VOCABULARY, status: "running" });
  onProgress({ agent: AgentName.GRAMMAR, status: "running" });
  onProgress({ agent: AgentName.WRITING, status: "running" });
  onProgress({ agent: AgentName.ASSESSMENT, status: "running" });

  const lockedContext = {
    passage: state.approvedPassageLock,
    difficultyLock: state.difficultyLock,
    teachingFrame: state.teachingFrame,
  };

  const [reading, vocabulary, grammar, writing, assessment] = await Promise.all(
    [
      runAgent<ReadingOutput>(AgentName.READING, request.provider, lockedContext),
      runAgent<VocabularyOutput>(AgentName.VOCABULARY, request.provider, lockedContext),
      runAgent<GrammarOutput>(AgentName.GRAMMAR, request.provider, lockedContext),
      runAgent<WritingOutput>(AgentName.WRITING, request.provider, lockedContext),
      runAgent<AssessmentOutput>(AgentName.ASSESSMENT, request.provider, lockedContext),
    ]
  );

  state.reading = reading;
  state.vocabulary = vocabulary;
  state.grammar = grammar;
  state.writing = writing;
  state.assessment = assessment;

  onProgress({ agent: AgentName.READING, status: "done", output: reading });
  onProgress({ agent: AgentName.VOCABULARY, status: "done", output: vocabulary });
  onProgress({ agent: AgentName.GRAMMAR, status: "done", output: grammar });
  onProgress({ agent: AgentName.WRITING, status: "done", output: writing });
  onProgress({ agent: AgentName.ASSESSMENT, status: "done", output: assessment });

  // 15. QA
  state.qa = await step<QAOutput>(
    AgentName.QA,
    request,
    {
      passage: state.approvedPassageLock,
      reading: state.reading,
      vocabulary: state.vocabulary,
      grammar: state.grammar,
      writing: state.writing,
      assessment: state.assessment,
      difficultyLock: state.difficultyLock,
    },
    onProgress
  );

  if (!state.qa.approvedForPublish) {
    throw new Error(
      `QA failed (score: ${state.qa.overallScore}): ${state.qa.issues.join(", ")}`
    );
  }

  // 16. Publisher
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

  state.publisher = await step<PublisherOutput>(
    AgentName.PUBLISHER,
    request,
    { lessonPackage, qa: state.qa },
    onProgress
  );

  return state.publisher.package;
}
