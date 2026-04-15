export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          academy_name: string | null;
          role: string;
          settings: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          academy_name?: string | null;
          role?: string;
          settings?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string | null;
          academy_name?: string | null;
          role?: string;
          settings?: Json | null;
          updated_at?: string;
        };
      };
      system_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          key: string;
          value?: Json;
          updated_at?: string;
        };
        Update: {
          value?: Json;
          updated_at?: string;
        };
      };
      lessons: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          difficulty: string;
          provider: string;
          status: string;
          reviewer_id: string | null;
          review_notes: string | null;
          submitted_at: string | null;
          reviewed_at: string | null;
          package: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          difficulty: string;
          provider: string;
          status?: string;
          reviewer_id?: string | null;
          review_notes?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          package: Json;
          created_at?: string;
        };
        Update: {
          title?: string;
          status?: string;
          reviewer_id?: string | null;
          review_notes?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          package?: Json;
        };
      };
      lesson_comments: {
        Row: {
          id: string;
          lesson_id: string;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          lesson_id: string;
          user_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          body?: string;
        };
      };
      lesson_activities: {
        Row: {
          id: string;
          lesson_id: string;
          actor_id: string | null;
          action: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lesson_id: string;
          actor_id?: string | null;
          action: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          actor_id?: string | null;
          action?: string;
          metadata?: Json | null;
        };
      };
      favorites: {
        Row: {
          id: string;
          user_id: string;
          lesson_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lesson_id: string;
          created_at?: string;
        };
        Update: never;
      };
      workflow_executions: {
        Row: {
          id: string;
          workflow: string;
          status: string;
          approval_status: string;
          risk_level: string;
          current_step: string | null;
          checkpoint: Json | null;
          input: Json;
          result: Json | null;
          error: string | null;
          steps: Json;
          started_at: string;
          completed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id: string;
          workflow: string;
          status: string;
          approval_status: string;
          risk_level: string;
          current_step?: string | null;
          checkpoint?: Json | null;
          input: Json;
          result?: Json | null;
          error?: string | null;
          steps?: Json;
          started_at: string;
          completed_at?: string | null;
          updated_at: string;
        };
        Update: {
          workflow?: string;
          status?: string;
          approval_status?: string;
          risk_level?: string;
          current_step?: string | null;
          checkpoint?: Json | null;
          input?: Json;
          result?: Json | null;
          error?: string | null;
          steps?: Json;
          started_at?: string;
          completed_at?: string | null;
          updated_at?: string;
        };
      };
      approval_requests: {
        Row: {
          id: string;
          workflow: string;
          execution_id: string;
          step: string | null;
          risk_level: string;
          title: string;
          summary: string;
          status: string;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          reason: string | null;
        };
        Insert: {
          id: string;
          workflow: string;
          execution_id: string;
          step?: string | null;
          risk_level: string;
          title: string;
          summary: string;
          status: string;
          created_at: string;
          decided_at?: string | null;
          decided_by?: string | null;
          reason?: string | null;
        };
        Update: {
          workflow?: string;
          execution_id?: string;
          step?: string | null;
          risk_level?: string;
          title?: string;
          summary?: string;
          status?: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          reason?: string | null;
        };
      };
      ai_usage_logs: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          model: string | null;
          workflow: string | null;
          agent: string | null;
          endpoint: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          total_tokens: number | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: string;
          model?: string | null;
          workflow?: string | null;
          agent?: string | null;
          endpoint?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          total_tokens?: number | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          provider?: string;
          model?: string | null;
          workflow?: string | null;
          agent?: string | null;
          endpoint?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          total_tokens?: number | null;
          metadata?: Json | null;
        };
      };
      studio_chat_threads: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          provider: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          provider?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          provider?: string | null;
          updated_at?: string;
        };
      };
      studio_chat_messages: {
        Row: {
          id: string;
          thread_id: string;
          user_id: string;
          role: string;
          text: string;
          agent_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          user_id: string;
          role: string;
          text: string;
          agent_name?: string | null;
          created_at?: string;
        };
        Update: {
          text?: string;
          agent_name?: string | null;
        };
      };
    };
  };
}
