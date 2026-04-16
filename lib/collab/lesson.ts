export type LessonStatus =
  | "draft"
  | "in_review"
  | "needs_revision"
  | "approved"
  | "published";

export interface LessonComment {
  id: string;
  lesson_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author_name?: string | null;
  author_role?: string | null;
}

export interface LessonReviewerOption {
  id: string;
  name: string;
  role: string;
  queueCount?: number;
  averageWaitHours?: number;
  overdueCount?: number;
  isRecommended?: boolean;
  recommendationReason?: string;
}

export interface LessonActivity {
  id: string;
  lesson_id: string;
  actor_id: string | null;
  action: string;
  created_at: string;
  metadata?: {
    from_status?: string | null;
    to_status?: string | null;
    note?: string | null;
    reviewer_id?: string | null;
    reviewer_name?: string | null;
    previous_reviewer_id?: string | null;
    previous_reviewer_name?: string | null;
    template_used?: boolean | null;
    template_kind?: "approved" | "needs_revision" | null;
    template_text?: string | null;
    delete_request_pending?: boolean | null;
    requester_id?: string | null;
    requester_name?: string | null;
  } | null;
  actor_name?: string | null;
  actor_role?: string | null;
}

export const LESSON_ACTIVITY_LABELS: Record<string, string> = {
  created: "레슨 생성",
  submitted_for_review: "검토 요청",
  status_changed: "상태 변경",
  approved: "승인",
  revision_requested: "수정 요청",
  commented: "코멘트 작성",
  reviewer_assigned: "검토자 지정",
  delete_requested: "삭제 요청",
  delete_request_cancelled: "삭제 요청 취소",
  deleted: "레슨 삭제",
};

export const LESSON_STATUS_LABELS: Record<LessonStatus, string> = {
  draft: "초안",
  in_review: "검토중",
  needs_revision: "수정 필요",
  approved: "승인됨",
  published: "발행 완료",
};
