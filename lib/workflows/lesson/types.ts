import {
  AIProvider,
  OnWorkflowProgress,
  WorkflowProgress,
  WorkflowStepStatus,
} from "../core/types";

export { AIProvider };

export enum AgentName {
  INTENT_ROUTER = "intent_router_agent",
  TEACHING_FRAME = "teaching_frame_agent",
  DIFFICULTY_LOCK = "difficulty_lock_agent",
  SOURCE_MODE_ROUTER = "source_mode_router_agent",
  TOPIC_SELECTION = "topic_selection_agent",
  RESEARCH_CURATION = "research_curation_agent",
  PASSAGE_GENERATION = "passage_generation_agent",
  PASSAGE_VALIDATION = "passage_validation_agent",
  APPROVED_PASSAGE_LOCK = "approved_passage_lock_agent",
  READING = "reading_agent",
  VOCABULARY = "vocabulary_agent",
  GRAMMAR = "grammar_agent",
  WRITING = "writing_agent",
  ASSESSMENT = "assessment_agent",
  QA = "qa_agent",
  PUBLISHER = "publisher_agent",
}

export type LessonWorkflowName = "lesson_generation";

export type DifficultyLevel =
  | "beginner"
  | "elementary"
  | "intermediate"
  | "upper-intermediate"
  | "advanced";

export type SourceMode = "topic" | "passage";

export interface IntentRouterOutput {
  intent: "generate_lesson" | "revise" | "query";
  sourceMode: SourceMode;
  rawInput: string;
}

export interface TeachingFrameOutput {
  gradeLevel: string;
  targetSkills: string[];
  lessonObjective: string;
}

export interface DifficultyLockOutput {
  difficulty: DifficultyLevel;
  wordCountTarget: number;
  vocabularyLevel: string;
  locked: true;
}

export interface SourceModeRouterOutput {
  mode: SourceMode;
  providedPassage?: string;
}

export interface TopicSelectionOutput {
  topic: string;
  rationale: string;
  keywords: string[];
}

export interface ResearchCurationOutput {
  facts: string[];
  sources: string[];
  summary: string;
}

export interface PassageGenerationOutput {
  passage: string;
  title: string;
  wordCount: number;
  difficulty: DifficultyLevel;
}

export interface PassageValidationOutput {
  approved: boolean;
  issues: string[];
  suggestions: string[];
}

export interface ApprovedPassageLockOutput {
  passage: string;
  title: string;
  wordCount: number;
  locked: true;
}

export interface ReadingOutput {
  questions: Array<{
    type: "comprehension" | "inference" | "vocabulary_in_context";
    question: string;
    options: string[];
    answer: string;
    explanation: string;
  }>;
}

export interface VocabularyOutput {
  words: Array<{
    word: string;
    definition: string;
    partOfSpeech: string;
    exampleSentence: string;
    koreanTranslation: string;
  }>;
}

export interface GrammarOutput {
  focusPoint: string;
  explanation: string;
  examples: string[];
  practiceExercises: Array<{
    instruction: string;
    items: string[];
    answers: string[];
  }>;
}

export interface WritingOutput {
  prompt: string;
  scaffolding: string[];
  rubric: Array<{
    criterion: string;
    maxPoints: number;
    description: string;
  }>;
  modelAnswer: string;
}

export interface AssessmentOutput {
  questions: Array<{
    type: "multiple_choice" | "short_answer" | "true_false";
    question: string;
    options?: string[];
    answer: string;
    points: number;
  }>;
  totalPoints: number;
  passingScore: number;
}

export interface QAOutput {
  passed: boolean;
  issues: string[];
  overallScore: number;
  approvedForPublish: boolean;
}

export interface PublisherMetaOutput {
  lessonId: string;
  publishedAt: string;
  status: "published";
}

export interface PublisherOutput {
  lessonId: string;
  publishedAt: string;
  package: LessonPackage;
  status: "published";
}

export interface LessonWorkflowState {
  intentRouter?: IntentRouterOutput;
  teachingFrame?: TeachingFrameOutput;
  difficultyLock?: DifficultyLockOutput;
  sourceModeRouter?: SourceModeRouterOutput;
  topicSelection?: TopicSelectionOutput;
  researchCuration?: ResearchCurationOutput;
  passageGeneration?: PassageGenerationOutput;
  passageValidation?: PassageValidationOutput;
  approvedPassageLock?: ApprovedPassageLockOutput;
  reading?: ReadingOutput;
  vocabulary?: VocabularyOutput;
  grammar?: GrammarOutput;
  writing?: WritingOutput;
  assessment?: AssessmentOutput;
  qa?: QAOutput;
  publisher?: PublisherOutput;
}

export interface ContentCounts {
  reading?: number;           // default 5 — 독해 문항 수
  vocabulary?: number;        // default 8 — 어휘 단어 수
  assessment?: number;        // default 10 — 평가 문항 수
  grammarExercises?: number;  // default 8 — 문법 연습 문제 총 개수
}

export const DEFAULT_CONTENT_COUNTS: Required<ContentCounts> = {
  reading: 5,
  vocabulary: 8,
  assessment: 10,
  grammarExercises: 8,
};

export interface LessonRequest {
  userInput: string;
  provider: AIProvider;
  difficulty?: DifficultyLevel;
  providedPassage?: string;
  approvalMode?: "auto" | "require_review";
  contentCounts?: ContentCounts;
}

export interface LessonPackage {
  title: string;
  difficulty: DifficultyLevel;
  passage: string;
  wordCount: number;
  reading: ReadingOutput;
  vocabulary: VocabularyOutput;
  grammar: GrammarOutput;
  writing: WritingOutput;
  assessment: AssessmentOutput;
}

export type AgentStatus = WorkflowStepStatus;

export interface AgentProgress
  extends WorkflowProgress<AgentName> {
  workflow: LessonWorkflowName;
  step: AgentName;
}

export type OnProgressCallback = OnWorkflowProgress<AgentName>;
