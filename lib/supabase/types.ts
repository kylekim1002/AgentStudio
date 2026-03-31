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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          academy_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string | null;
          academy_name?: string | null;
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
          package: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          difficulty: string;
          provider: string;
          package: Json;
          created_at?: string;
        };
        Update: {
          title?: string;
          package?: Json;
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
    };
  };
}
