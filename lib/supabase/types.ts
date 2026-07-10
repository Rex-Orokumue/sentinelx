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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_flags: {
        Row: {
          created_at: string
          flagged_by: string
          id: string
          player_id: string
          reason: string
          severity: string
        }
        Insert: {
          created_at?: string
          flagged_by: string
          id?: string
          player_id: string
          reason: string
          severity: string
        }
        Update: {
          created_at?: string
          flagged_by?: string
          id?: string
          player_id?: string
          reason?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_flags_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_flags_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          active: boolean
          created_at: string
          icon_url: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          icon_url?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          icon_url?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      group_memberships: {
        Row: {
          draws: number
          goals_against: number
          goals_for: number
          group_id: string
          id: string
          losses: number
          player_id: string
          points: number
          wins: number
        }
        Insert: {
          draws?: number
          goals_against?: number
          goals_for?: number
          group_id: string
          id?: string
          losses?: number
          player_id: string
          points?: number
          wins?: number
        }
        Update: {
          draws?: number
          goals_against?: number
          goals_for?: number
          group_id?: string
          id?: string
          losses?: number
          player_id?: string
          points?: number
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          name: string
          tournament_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tournament_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          category: string
          created_at: string
          currency: string
          description: string | null
          escrow_status: string | null
          game_id: string | null
          id: string
          price: number
          seller_id: string
          status: string
          title: string
          updated_at: string
          zolarux_reference: string | null
        }
        Insert: {
          category: string
          created_at?: string
          currency?: string
          description?: string | null
          escrow_status?: string | null
          game_id?: string | null
          id?: string
          price: number
          seller_id: string
          status?: string
          title: string
          updated_at?: string
          zolarux_reference?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          currency?: string
          description?: string | null
          escrow_status?: string | null
          game_id?: string | null
          id?: string
          price?: number
          seller_id?: string
          status?: string
          title?: string
          updated_at?: string
          zolarux_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_results: {
        Row: {
          created_at: string
          id: string
          match_id: string
          recording_url: string | null
          score_a: number
          score_b: number
          screenshot_url: string | null
          status: string
          submitted_by: string
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          recording_url?: string | null
          score_a: number
          score_b: number
          screenshot_url?: string | null
          status?: string
          submitted_by: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          recording_url?: string | null
          score_a?: number
          score_b?: number
          screenshot_url?: string | null
          status?: string
          submitted_by?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_results_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_results_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_results_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          admin_note: string | null
          completed_at: string | null
          created_at: string
          group_id: string | null
          id: string
          player_a_id: string | null
          player_b_id: string | null
          replay_url: string | null
          round: string
          scheduled_at: string | null
          score_a: number | null
          score_b: number | null
          status: string
          tournament_id: string
          updated_at: string
          youtube_stream_url: string | null
        }
        Insert: {
          admin_note?: string | null
          completed_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          player_a_id?: string | null
          player_b_id?: string | null
          replay_url?: string | null
          round: string
          scheduled_at?: string | null
          score_a?: number | null
          score_b?: number | null
          status?: string
          tournament_id: string
          updated_at?: string
          youtube_stream_url?: string | null
        }
        Update: {
          admin_note?: string | null
          completed_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          player_a_id?: string | null
          player_b_id?: string | null
          replay_url?: string | null
          round?: string
          scheduled_at?: string | null
          score_a?: number | null
          score_b?: number | null
          status?: string
          tournament_id?: string
          updated_at?: string
          youtube_stream_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_a_id_fkey"
            columns: ["player_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_b_id_fkey"
            columns: ["player_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      opponent_ratings: {
        Row: {
          created_at: string
          id: string
          match_id: string
          rated_id: string
          rater_id: string
          stars: number
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          rated_id: string
          rater_id: string
          stars: number
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          rated_id?: string
          rater_id?: string
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "opponent_ratings_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opponent_ratings_rated_id_fkey"
            columns: ["rated_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opponent_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country: string | null
          created_at: string
          display_name: string | null
          goals_conceded: number
          goals_scored: number
          id: string
          kyc_verified: boolean
          losses: number
          phone: string | null
          sentinel_score: number
          sentinel_tier: string | null
          total_matches: number
          total_titles: number
          updated_at: string
          username: string | null
          whatsapp_number: string | null
          wins: number
        }
        Insert: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          goals_conceded?: number
          goals_scored?: number
          id: string
          kyc_verified?: boolean
          losses?: number
          phone?: string | null
          sentinel_score?: number
          sentinel_tier?: string | null
          total_matches?: number
          total_titles?: number
          updated_at?: string
          username?: string | null
          whatsapp_number?: string | null
          wins?: number
        }
        Update: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          goals_conceded?: number
          goals_scored?: number
          id?: string
          kyc_verified?: boolean
          losses?: number
          phone?: string | null
          sentinel_score?: number
          sentinel_tier?: string | null
          total_matches?: number
          total_titles?: number
          updated_at?: string
          username?: string | null
          whatsapp_number?: string | null
          wins?: number
        }
        Relationships: []
      }
      sentinel_score_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          match_id: string | null
          note: string | null
          player_id: string
          points_delta: number
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          match_id?: string | null
          note?: string | null
          player_id: string
          points_delta: number
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          match_id?: string | null
          note?: string | null
          player_id?: string
          points_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "sentinel_score_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sentinel_score_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_registrations: {
        Row: {
          id: string
          payment_status: string
          paystack_reference: string | null
          player_id: string
          registered_at: string
          tournament_id: string
        }
        Insert: {
          id?: string
          payment_status?: string
          paystack_reference?: string | null
          player_id: string
          registered_at?: string
          tournament_id: string
        }
        Update: {
          id?: string
          payment_status?: string
          paystack_reference?: string | null
          player_id?: string
          registered_at?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_registrations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_registrations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          banner_url: string | null
          created_at: string
          description: string | null
          format: string
          game_id: string
          id: string
          max_players: number | null
          prize_pool: number
          registration_end: string | null
          registration_fee: number
          registration_start: string | null
          slug: string
          status: string
          title: string
          tournament_end: string | null
          tournament_start: string | null
          updated_at: string
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          format?: string
          game_id: string
          id?: string
          max_players?: number | null
          prize_pool?: number
          registration_end?: string | null
          registration_fee?: number
          registration_start?: string | null
          slug: string
          status?: string
          title: string
          tournament_end?: string | null
          tournament_start?: string | null
          updated_at?: string
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          format?: string
          game_id?: string
          id?: string
          max_players?: number | null
          prize_pool?: number
          registration_end?: string | null
          registration_fee?: number
          registration_start?: string | null
          slug?: string
          status?: string
          title?: string
          tournament_end?: string | null
          tournament_start?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      tv_videos: {
        Row: {
          active: boolean
          category: string
          created_by: string
          description: string | null
          id: string
          published_at: string
          thumbnail_url: string | null
          title: string
          youtube_url: string
        }
        Insert: {
          active?: boolean
          category: string
          created_by: string
          description?: string | null
          id?: string
          published_at?: string
          thumbnail_url?: string | null
          title: string
          youtube_url: string
        }
        Update: {
          active?: boolean
          category?: string
          created_by?: string
          description?: string | null
          id?: string
          published_at?: string
          thumbnail_url?: string | null
          title?: string
          youtube_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "tv_videos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          role: string
          user_id: string
        }
        Update: {
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_requests: {
        Row: {
          account_name: string
          account_number: string
          admin_note: string | null
          amount: number
          bank_name: string
          id: string
          player_id: string
          requested_at: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          account_name: string
          account_number: string
          admin_note?: string | null
          amount: number
          bank_name: string
          id?: string
          player_id: string
          requested_at?: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          admin_note?: string | null
          amount?: number
          bank_name?: string
          id?: string
          player_id?: string
          requested_at?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      player_rank: { Args: { uname: string }; Returns: number }
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

export const Constants = {
  public: {
    Enums: {},
  },
} as const
