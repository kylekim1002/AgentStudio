import { AgentName } from "./agents/types";

export interface AgentMeta {
  num: string;
  label: string;           // 한국어 이름
  mention: string;         // @mention 키워드
  desc: string;            // 툴팁 설명
  tag: string;             // 역할 태그
  group: string;           // 그룹명
  parallel?: boolean;
  conditional?: boolean;
}

export const AGENT_META: Record<AgentName, AgentMeta> = {
  [AgentName.INTENT_ROUTER]: {
    num: "01", label: "의도 분석기", mention: "intent_router",
    desc: "사용자의 요청을 해석해 '레슨 생성 / 수정 / 질문' 중 하나로 분류하고, 지문 소스 방식(주제 생성 vs 직접 제공)을 결정합니다.",
    tag: "분석", group: "분석 단계",
  },
  [AgentName.TEACHING_FRAME]: {
    num: "02", label: "교수 프레임 설계기", mention: "teaching_frame",
    desc: "대상 학년과 학습 목표를 설정합니다. 독해·어휘·문법 등 집중할 스킬을 결정하고 이후 모든 에이전트의 기준이 됩니다.",
    tag: "설계", group: "분석 단계",
  },
  [AgentName.DIFFICULTY_LOCK]: {
    num: "03", label: "난이도 잠금기", mention: "difficulty_lock",
    desc: "난이도(beginner~advanced)와 목표 단어 수·어휘 수준을 확정하고 잠급니다. 이후 모든 에이전트는 이 값을 반드시 준수합니다.",
    tag: "설계", group: "분석 단계",
  },
  [AgentName.SOURCE_MODE_ROUTER]: {
    num: "04", label: "소스 경로 결정기", mention: "source_mode_router",
    desc: "'주제 선정 → 지문 생성' 경로와 '직접 제공 지문 사용' 경로 중 하나를 선택합니다. 지문이 제공된 경우 5·6번 에이전트를 건너뜁니다.",
    tag: "라우팅", group: "분석 단계",
  },
  [AgentName.TOPIC_SELECTION]: {
    num: "05", label: "주제 선정기", mention: "topic_selection",
    desc: "교수 프레임과 난이도를 바탕으로 레슨에 적합한 구체적 주제를 선정합니다. 지문이 직접 제공된 경우 이 단계는 건너뜁니다.",
    tag: "조건부", group: "주제 단계", conditional: true,
  },
  [AgentName.RESEARCH_CURATION]: {
    num: "06", label: "리서치 큐레이터", mention: "research_curation",
    desc: "선정된 주제에 맞는 핵심 사실과 어휘를 수집·정리합니다. 지문 생성에 활용할 고품질 정보를 선별합니다. 주제 모드에서만 실행됩니다.",
    tag: "조건부", group: "주제 단계", conditional: true,
  },
  [AgentName.PASSAGE_GENERATION]: {
    num: "07", label: "지문 생성기", mention: "passage_generation",
    desc: "리서치 결과와 난이도 설정을 바탕으로 영어 지문을 작성합니다. 목표 단어 수와 어휘 수준을 정확히 맞춥니다.",
    tag: "핵심", group: "지문 생성",
  },
  [AgentName.PASSAGE_VALIDATION]: {
    num: "08", label: "지문 검증기", mention: "passage_validation",
    desc: "생성된 지문의 난이도·단어 수·문법 정확성·교육 적합성을 검토합니다. 기준 미달 시 파이프라인을 중단하고 오류를 보고합니다.",
    tag: "검증", group: "지문 생성",
  },
  [AgentName.APPROVED_PASSAGE_LOCK]: {
    num: "09", label: "지문 확정 잠금기", mention: "approved_passage_lock",
    desc: "검증 통과한 지문을 최종 확정하고 잠급니다. 이후 콘텐츠 에이전트들은 이 지문을 기준으로 문제·학습 자료를 만듭니다.",
    tag: "잠금", group: "지문 생성",
  },
  [AgentName.READING]: {
    num: "10", label: "독해 문제 생성기", mention: "reading",
    desc: "지문을 바탕으로 이해·추론·문맥 어휘 유형의 독해 문제 5개를 만듭니다. 정답과 해설을 함께 제공합니다.",
    tag: "병렬", group: "콘텐츠 생성", parallel: true,
  },
  [AgentName.VOCABULARY]: {
    num: "11", label: "어휘 학습 생성기", mention: "vocabulary",
    desc: "지문의 핵심 어휘를 선별하고 정의·품사·예문·한국어 번역을 포함한 어휘 학습 카드를 만듭니다.",
    tag: "병렬", group: "콘텐츠 생성", parallel: true,
  },
  [AgentName.GRAMMAR]: {
    num: "12", label: "문법 문제 생성기", mention: "grammar",
    desc: "지문에서 핵심 문법 포인트를 뽑아 설명·예문·문법 문제를 구성합니다. 학년 수준에 맞는 문법 개념을 선택합니다.",
    tag: "병렬", group: "콘텐츠 생성", parallel: true,
  },
  [AgentName.WRITING]: {
    num: "13", label: "쓰기 과제 생성기", mention: "writing",
    desc: "지문 주제와 연계된 쓰기 과제를 설계합니다. 스캐폴딩·루브릭·모범 답안을 함께 제공합니다.",
    tag: "병렬", group: "콘텐츠 생성", parallel: true,
  },
  [AgentName.ASSESSMENT]: {
    num: "14", label: "평가지 생성기", mention: "assessment",
    desc: "객관식·단답형·OX 혼합 평가 문항을 만듭니다. 배점과 통과 점수를 자동 계산합니다.",
    tag: "병렬", group: "콘텐츠 생성", parallel: true,
  },
  [AgentName.QA]: {
    num: "15", label: "품질 검수기 (QA)", mention: "qa",
    desc: "지문·독해·어휘·문법·쓰기·평가 전체를 종합 검토합니다. 점수가 기준 미달이면 발행을 차단하고 문제점을 보고합니다.",
    tag: "검수", group: "검수 & 발행",
  },
  [AgentName.PUBLISHER]: {
    num: "16", label: "최종 발행기", mention: "publisher",
    desc: "QA를 통과한 레슨에 고유 ID와 발행 시각을 부여합니다. 전체 레슨 패키지를 조립해 저장 가능한 형태로 완성합니다.",
    tag: "발행", group: "검수 & 발행",
  },
};

// 파이프라인 순서대로 정렬된 배열
export const PIPELINE_ORDER: AgentName[] = [
  AgentName.INTENT_ROUTER,
  AgentName.TEACHING_FRAME,
  AgentName.DIFFICULTY_LOCK,
  AgentName.SOURCE_MODE_ROUTER,
  AgentName.TOPIC_SELECTION,
  AgentName.RESEARCH_CURATION,
  AgentName.PASSAGE_GENERATION,
  AgentName.PASSAGE_VALIDATION,
  AgentName.APPROVED_PASSAGE_LOCK,
  AgentName.READING,
  AgentName.VOCABULARY,
  AgentName.GRAMMAR,
  AgentName.WRITING,
  AgentName.ASSESSMENT,
  AgentName.QA,
  AgentName.PUBLISHER,
];

// 그룹 순서
export const AGENT_GROUPS = [
  "분석 단계",
  "주제 단계",
  "지문 생성",
  "콘텐츠 생성",
  "검수 & 발행",
] as const;
