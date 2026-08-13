/**
 * Auto-generated database types from Supabase schema.
 * Reflects the current state of netflix_users, files, and aggregate views.
 */

export type Database = {
  public: {
    Tables: {
      netflix_users: {
        Row: {
          user_id: number;
          name: string | null;
          age: number | null;
          country: string | null;
          subscription_type: string | null;
          watch_time_hours: number | null;
          favorite_genre: string | null;
          last_login: string | null;
        };
        Insert: {
          user_id: number;
          name?: string | null;
          age?: number | null;
          country?: string | null;
          subscription_type?: string | null;
          watch_time_hours?: number | null;
          favorite_genre?: string | null;
          last_login?: string | null;
        };
        Update: {
          user_id?: number;
          name?: string | null;
          age?: number | null;
          country?: string | null;
          subscription_type?: string | null;
          watch_time_hours?: number | null;
          favorite_genre?: string | null;
          last_login?: string | null;
        };
        Relationships: [];
      };
      files: {
        Row: {
          id: number;
          owner_id: string;
          object_path: string;
          original_name: string;
          content_type: string | null;
          size_bytes: number | null;
          uploaded_at: string;
        };
        Insert: {
          id?: number;
          owner_id: string;
          object_path: string;
          original_name: string;
          content_type?: string | null;
          size_bytes?: number | null;
          uploaded_at?: string;
        };
        Update: {
          id?: number;
          owner_id?: string;
          object_path?: string;
          original_name?: string;
          content_type?: string | null;
          size_bytes?: number | null;
          uploaded_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      netflix_overview: {
        Row: {
          total_users: number | null;
          avg_age: number | null;
          avg_watch_time_hours: number | null;
          country_count: number | null;
        };
        Relationships: [];
      };
      netflix_country_stats: {
        Row: {
          country: string | null;
          user_count: number | null;
        };
        Relationships: [];
      };
      netflix_genre_stats: {
        Row: {
          favorite_genre: string | null;
          user_count: number | null;
        };
        Relationships: [];
      };
      netflix_subscription_stats: {
        Row: {
          subscription_type: string | null;
          user_count: number | null;
          avg_watch_time_hours: number | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, unknown>;
    Enums: Record<string, unknown>;
    CompositeTypes: Record<string, unknown>;
  };
};
