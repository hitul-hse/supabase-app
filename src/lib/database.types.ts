/**
 * Auto-generated database types from Supabase schema.
 * Reflects the current state of netflix_users, files, the HSE Hub tables,
 * the RBAC tables (app_role, app_user_profile), and aggregate views.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      app_permission: {
        Row: {
          action: string
          description: string | null
          display_name: string
          permission_key: string
          resource: string
          sort_order: number
        }
        Insert: {
          action: string
          description?: string | null
          display_name: string
          permission_key: string
          resource: string
          sort_order?: number
        }
        Update: {
          action?: string
          description?: string | null
          display_name?: string
          permission_key?: string
          resource?: string
          sort_order?: number
        }
        Relationships: []
      }
      app_role: {
        Row: {
          display_name: string
          role_key: string
          seniority: number
        }
        Insert: {
          display_name: string
          role_key: string
          seniority: number
        }
        Update: {
          display_name?: string
          role_key?: string
          seniority?: number
        }
        Relationships: []
      }
      app_role_permission: {
        Row: {
          granted_at: string
          permission_key: string
          role_key: string
        }
        Insert: {
          granted_at?: string
          permission_key: string
          role_key: string
        }
        Update: {
          granted_at?: string
          permission_key?: string
          role_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_role_permission_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "app_permission"
            referencedColumns: ["permission_key"]
          },
          {
            foreignKeyName: "app_role_permission_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "app_role"
            referencedColumns: ["role_key"]
          },
        ]
      }
      app_user_profile: {
        Row: {
          created_at: string
          department: string | null
          is_active: boolean
          person_id: string | null
          role_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          is_active?: boolean
          person_id?: string | null
          role_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          is_active?: boolean
          person_id?: string | null
          role_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_user_profile_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_user_profile_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "app_role"
            referencedColumns: ["role_key"]
          },
        ]
      }
      approval_decisions: {
        Row: {
          id: string
          primary_action: string
          secondary_action: string | null
          sort_order: number
          status: string
          subtitle: string
          title: string
          type: string
        }
        Insert: {
          id: string
          primary_action: string
          secondary_action?: string | null
          sort_order: number
          status?: string
          subtitle: string
          title: string
          type: string
        }
        Update: {
          id?: string
          primary_action?: string
          secondary_action?: string | null
          sort_order?: number
          status?: string
          subtitle?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      executive_metrics: {
        Row: {
          id: number
          label: string
          progress_color: string | null
          progress_percent: number | null
          sort_order: number
          subtext: string
          subtext_color: string | null
          value: string
        }
        Insert: {
          id?: never
          label: string
          progress_color?: string | null
          progress_percent?: number | null
          sort_order: number
          subtext: string
          subtext_color?: string | null
          value: string
        }
        Update: {
          id?: never
          label?: string
          progress_color?: string | null
          progress_percent?: number | null
          sort_order?: number
          subtext?: string
          subtext_color?: string | null
          value?: string
        }
        Relationships: []
      }
      files: {
        Row: {
          content_type: string | null
          id: number
          object_path: string
          original_name: string
          owner_id: string
          size_bytes: number | null
          uploaded_at: string
        }
        Insert: {
          content_type?: string | null
          id?: never
          object_path: string
          original_name: string
          owner_id: string
          size_bytes?: number | null
          uploaded_at?: string
        }
        Update: {
          content_type?: string | null
          id?: never
          object_path?: string
          original_name?: string
          owner_id?: string
          size_bytes?: number | null
          uploaded_at?: string
        }
        Relationships: []
      }
      netflix_users: {
        Row: {
          age: number | null
          country: string | null
          favorite_genre: string | null
          last_login: string | null
          name: string | null
          subscription_type: string | null
          user_id: number
          watch_time_hours: number | null
        }
        Insert: {
          age?: number | null
          country?: string | null
          favorite_genre?: string | null
          last_login?: string | null
          name?: string | null
          subscription_type?: string | null
          user_id: number
          watch_time_hours?: number | null
        }
        Update: {
          age?: number | null
          country?: string | null
          favorite_genre?: string | null
          last_login?: string | null
          name?: string | null
          subscription_type?: string | null
          user_id?: number
          watch_time_hours?: number | null
        }
        Relationships: []
      }
      people: {
        Row: {
          billable_share: number
          capacity_status: string
          certificate_status: string | null
          certificate_text: string | null
          contract_hours: number
          department: string
          employee_number: string
          holiday_left: number
          id: string
          logged_this_month: number
          manager_id: string | null
          name: string
          open_tasks: number
          overdue_tasks: number
          role: string
          since: string
          timesheet_status: string | null
          total_holiday: number
          total_monthly_hours: number
        }
        Insert: {
          billable_share: number
          capacity_status: string
          certificate_status?: string | null
          certificate_text?: string | null
          contract_hours: number
          department: string
          employee_number: string
          holiday_left: number
          id: string
          logged_this_month: number
          manager_id?: string | null
          name: string
          open_tasks: number
          overdue_tasks: number
          role: string
          since: string
          timesheet_status?: string | null
          total_holiday: number
          total_monthly_hours: number
        }
        Update: {
          billable_share?: number
          capacity_status?: string
          certificate_status?: string | null
          certificate_text?: string | null
          contract_hours?: number
          department?: string
          employee_number?: string
          holiday_left?: number
          id?: string
          logged_this_month?: number
          manager_id?: string | null
          name?: string
          open_tasks?: number
          overdue_tasks?: number
          role?: string
          since?: string
          timesheet_status?: string | null
          total_holiday?: number
          total_monthly_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "people_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_assignments: {
        Row: {
          id: number
          logged_hours: number
          person_id: string
          project_id: string | null
          project_name: string
          share_percent: number
          sort_order: number
          tasks_count: number
        }
        Insert: {
          id?: never
          logged_hours: number
          person_id: string
          project_id?: string | null
          project_name: string
          share_percent: number
          sort_order: number
          tasks_count: number
        }
        Update: {
          id?: never
          logged_hours?: number
          person_id?: string
          project_id?: string | null
          project_name?: string
          share_percent?: number
          sort_order?: number
          tasks_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "person_assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      person_qualifications: {
        Row: {
          id: number
          name: string
          person_id: string
          sort_order: number
          status: string
          validity: string
        }
        Insert: {
          id?: never
          name: string
          person_id: string
          sort_order: number
          status: string
          validity: string
        }
        Update: {
          id?: never
          name?: string
          person_id?: string
          sort_order?: number
          status?: string
          validity?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_qualifications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          created_by: string | null
          estimate_hours: number
          id: number
          logged_hours: number
          name: string
          owner: string
          project_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          created_by?: string | null
          estimate_hours: number
          id?: never
          logged_hours: number
          name: string
          owner: string
          project_id: string
          sort_order: number
          status: string
          updated_at?: string
        }
        Update: {
          created_by?: string | null
          estimate_hours?: number
          id?: never
          logged_hours?: number
          name?: string
          owner?: string
          project_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_timeline: {
        Row: {
          id: number
          period: string
          progress_percent: number
          project_id: string
          sort_order: number
          status: string
          title: string
        }
        Insert: {
          id?: never
          period: string
          progress_percent: number
          project_id: string
          sort_order: number
          status: string
          title: string
        }
        Update: {
          id?: never
          period?: string
          progress_percent?: number
          project_id?: string
          sort_order?: number
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_timeline_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          billable_hours: number
          change_requests: string | null
          code: string
          consumed_percent: number
          contract_hours: number
          contract_type: string | null
          contract_value_eur: number | null
          customer: string
          department: string | null
          due: string
          forecast_overrun: number | null
          id: string
          invoiced_eur: number | null
          lead: string
          logged_hours: number | null
          name: string
          owner_person_id: string | null
          remaining_hours: number | null
          status: string
          team_size: number | null
        }
        Insert: {
          billable_hours: number
          change_requests?: string | null
          code: string
          consumed_percent: number
          contract_hours: number
          contract_type?: string | null
          contract_value_eur?: number | null
          customer: string
          department?: string | null
          due: string
          forecast_overrun?: number | null
          id: string
          invoiced_eur?: number | null
          lead: string
          logged_hours?: number | null
          name: string
          owner_person_id?: string | null
          remaining_hours?: number | null
          status: string
          team_size?: number | null
        }
        Update: {
          billable_hours?: number
          change_requests?: string | null
          code?: string
          consumed_percent?: number
          contract_hours?: number
          contract_type?: string | null
          contract_value_eur?: number | null
          customer?: string
          department?: string | null
          due?: string
          forecast_overrun?: number | null
          id?: string
          invoiced_eur?: number | null
          lead?: string
          logged_hours?: number | null
          name?: string
          owner_person_id?: string | null
          remaining_hours?: number | null
          status?: string
          team_size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_owner_person_id_fkey"
            columns: ["owner_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_sources: {
        Row: {
          freshness: string
          message: string | null
          sort_order: number
          source: string
          status: string
        }
        Insert: {
          freshness: string
          message?: string | null
          sort_order: number
          source: string
          status: string
        }
        Update: {
          freshness?: string
          message?: string | null
          sort_order?: number
          source?: string
          status?: string
        }
        Relationships: []
      }
      team_utilisations: {
        Row: {
          id: number
          percent: number | null
          sort_order: number
          status_color: string | null
          team: string
        }
        Insert: {
          id?: never
          percent?: number | null
          sort_order: number
          status_color?: string | null
          team: string
        }
        Update: {
          id?: never
          percent?: number | null
          sort_order?: number
          status_color?: string | null
          team?: string
        }
        Relationships: []
      }
      timesheet_entries: {
        Row: {
          customer: string | null
          day_of_week: number
          entry_group: number
          hours: number
          id: number
          is_billable: boolean
          person_id: string
          project_name: string
          status: string
          submitted_at: string | null
          task_name: string
          warning: string | null
          week_start: string
        }
        Insert: {
          customer?: string | null
          day_of_week: number
          entry_group: number
          hours: number
          id?: never
          is_billable: boolean
          person_id: string
          project_name: string
          status?: string
          submitted_at?: string | null
          task_name: string
          warning?: string | null
          week_start?: string
        }
        Update: {
          customer?: string | null
          day_of_week?: number
          entry_group?: number
          hours?: number
          id?: never
          is_billable?: boolean
          person_id?: string
          project_name?: string
          status?: string
          submitted_at?: string | null
          task_name?: string
          warning?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_bookings: {
        Row: {
          hours: number | null
          id: number
          person_id: string
          status: string
          week: string
        }
        Insert: {
          hours?: number | null
          id?: never
          person_id: string
          status: string
          week: string
        }
        Update: {
          hours?: number | null
          id?: never
          person_id?: string
          status?: string
          week?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_bookings_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_employee_summary: {
        Row: {
          absence_label: string | null
          absence_minutes: number | null
          billable_seconds: number
          empty_tasks_seconds: number
          employee_name: string
          expected_minutes: number
          factorial_employee_id: string
          id: number
          internal_project_seconds: number
          period_end: string
          period_start: string
          person_id: string | null
          review_entry_count: number
          synced_at: string
          trackingtime_user_id: string | null
          travel_time_seconds: number
          worked_day_count: number
          worked_minutes: number
        }
        Insert: {
          absence_label?: string | null
          absence_minutes?: number | null
          billable_seconds: number
          empty_tasks_seconds: number
          employee_name: string
          expected_minutes: number
          factorial_employee_id: string
          id?: never
          internal_project_seconds: number
          period_end: string
          period_start: string
          person_id?: string | null
          review_entry_count?: number
          synced_at?: string
          trackingtime_user_id?: string | null
          travel_time_seconds: number
          worked_day_count: number
          worked_minutes: number
        }
        Update: {
          absence_label?: string | null
          absence_minutes?: number | null
          billable_seconds?: number
          empty_tasks_seconds?: number
          employee_name?: string
          expected_minutes?: number
          factorial_employee_id?: string
          id?: never
          internal_project_seconds?: number
          period_end?: string
          period_start?: string
          person_id?: string | null
          review_entry_count?: number
          synced_at?: string
          trackingtime_user_id?: string | null
          travel_time_seconds?: number
          worked_day_count?: number
          worked_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_employee_summary_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_trends: {
        Row: {
          billable_hours: number
          id: number
          is_open: boolean
          non_billable_hours: number
          sort_order: number
          week: string
        }
        Insert: {
          billable_hours: number
          id?: never
          is_open?: boolean
          non_billable_hours: number
          sort_order: number
          week: string
        }
        Update: {
          billable_hours?: number
          id?: never
          is_open?: boolean
          non_billable_hours?: number
          sort_order?: number
          week?: string
        }
        Relationships: []
      }
    }
    Views: {
      org_chart_nodes: {
        Row: {
          department: string | null
          id: string | null
          manager_id: string | null
          name: string | null
          role: string | null
        }
        Relationships: []
      }
      person_week_metrics: {
        Row: {
          absence_hours: number | null
          absence_label: string | null
          billable_hours: number | null
          billable_share_percent: number | null
          capacity_status: string | null
          department: string | null
          expected_hours: number | null
          factorial_employee_id: string | null
          name: string | null
          non_billable_hours: number | null
          period_end: string | null
          period_start: string | null
          person_id: string | null
          review_entry_count: number | null
          synced_at: string | null
          worked_day_count: number | null
          worked_hours: number | null
        }
        Relationships: []
      }
      weekly_billable_trend: {
        Row: {
          billable_hours: number | null
          employee_count: number | null
          non_billable_hours: number | null
          period_end: string | null
          period_start: string | null
        }
        Relationships: []
      }
      netflix_country_stats: {
        Row: {
          country: string | null
          user_count: number | null
        }
        Relationships: []
      }
      netflix_genre_stats: {
        Row: {
          favorite_genre: string | null
          user_count: number | null
        }
        Relationships: []
      }
      netflix_overview: {
        Row: {
          avg_age: number | null
          avg_watch_time_hours: number | null
          country_count: number | null
          total_users: number | null
        }
        Relationships: []
      }
      netflix_subscription_stats: {
        Row: {
          avg_watch_time_hours: number | null
          subscription_type: string | null
          user_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      app_user_department: { Args: never; Returns: string }
      app_user_has_permission: { Args: { p_key: string }; Returns: boolean }
      app_user_person_id: { Args: never; Returns: string }
      app_user_role: { Args: never; Returns: string }
      can_view_person: { Args: { target_person_id: string }; Returns: boolean }
      can_view_project: {
        Args: { target_project_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
