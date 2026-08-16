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
      achievements: {
        Row: {
          category: string
          coin_reward: number
          description: string
          icon_url: string | null
          id: string
          name: string
          phase: string
          share_to_feed: boolean
          slug: string
          sort_order: number
          xp_reward: number
        }
        Insert: {
          category: string
          coin_reward?: number
          description: string
          icon_url?: string | null
          id?: string
          name: string
          phase?: string
          share_to_feed?: boolean
          slug: string
          sort_order?: number
          xp_reward?: number
        }
        Update: {
          category?: string
          coin_reward?: number
          description?: string
          icon_url?: string | null
          id?: string
          name?: string
          phase?: string
          share_to_feed?: boolean
          slug?: string
          sort_order?: number
          xp_reward?: number
        }
        Relationships: []
      }
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
      best_play_nominations: {
        Row: {
          created_at: string
          id: string
          is_winner: boolean
          post_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_winner?: boolean
          post_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          is_winner?: boolean
          post_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "best_play_nominations_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      best_play_votes: {
        Row: {
          created_at: string
          id: string
          nomination_id: string
          player_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          nomination_id: string
          player_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          nomination_id?: string
          player_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "best_play_votes_nomination_id_fkey"
            columns: ["nomination_id"]
            isOneToOne: false
            referencedRelation: "best_play_nominations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "best_play_votes_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      buy_requests: {
        Row: {
          admin_note: string | null
          budget: number
          buyer_id: string
          category: string
          created_at: string
          description: string | null
          game_id: string | null
          id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          budget: number
          buyer_id: string
          category: string
          created_at?: string
          description?: string | null
          game_id?: string | null
          id?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          budget?: number
          buyer_id?: string
          category?: string
          created_at?: string
          description?: string | null
          game_id?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buy_requests_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buy_requests_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      community_challenges: {
        Row: {
          active: boolean
          challenge_type: string
          coin_reward: number
          description: string
          goal: number
          id: string
          slug: string
          title: string
          xp_reward: number
        }
        Insert: {
          active?: boolean
          challenge_type: string
          coin_reward?: number
          description: string
          goal: number
          id?: string
          slug: string
          title: string
          xp_reward?: number
        }
        Update: {
          active?: boolean
          challenge_type?: string
          coin_reward?: number
          description?: string
          goal?: number
          id?: string
          slug?: string
          title?: string
          xp_reward?: number
        }
        Relationships: []
      }
      community_posts: {
        Row: {
          author_id: string | null
          boosted_until: string | null
          content: string
          created_at: string
          deleted_reason: string | null
          id: string
          image_url: string | null
          is_deleted: boolean
          is_pinned: boolean
          post_type: string
          reference_id: string | null
        }
        Insert: {
          author_id?: string | null
          boosted_until?: string | null
          content: string
          created_at?: string
          deleted_reason?: string | null
          id?: string
          image_url?: string | null
          is_deleted?: boolean
          is_pinned?: boolean
          post_type?: string
          reference_id?: string | null
        }
        Update: {
          author_id?: string | null
          boosted_until?: string | null
          content?: string
          created_at?: string
          deleted_reason?: string | null
          id?: string
          image_url?: string | null
          is_deleted?: boolean
          is_pinned?: boolean
          post_type?: string
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendly_match_results: {
        Row: {
          created_at: string
          friendly_match_id: string
          id: string
          score_challenger: number
          score_opponent: number
          screenshot_url: string
          submitted_by: string
        }
        Insert: {
          created_at?: string
          friendly_match_id: string
          id?: string
          score_challenger: number
          score_opponent: number
          screenshot_url: string
          submitted_by: string
        }
        Update: {
          created_at?: string
          friendly_match_id?: string
          id?: string
          score_challenger?: number
          score_opponent?: number
          screenshot_url?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendly_match_results_friendly_match_id_fkey"
            columns: ["friendly_match_id"]
            isOneToOne: false
            referencedRelation: "friendly_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendly_match_results_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendly_matches: {
        Row: {
          admin_note: string | null
          challenger_id: string
          challenger_paid: boolean
          challenger_paystack_reference: string | null
          completed_at: string | null
          created_at: string
          game_code: string | null
          id: string
          opponent_id: string
          opponent_paid: boolean
          opponent_paystack_reference: string | null
          score_challenger: number | null
          score_opponent: number | null
          stake_amount: number | null
          stake_currency: string | null
          status: string
          winner_id: string | null
        }
        Insert: {
          admin_note?: string | null
          challenger_id: string
          challenger_paid?: boolean
          challenger_paystack_reference?: string | null
          completed_at?: string | null
          created_at?: string
          game_code?: string | null
          id?: string
          opponent_id: string
          opponent_paid?: boolean
          opponent_paystack_reference?: string | null
          score_challenger?: number | null
          score_opponent?: number | null
          stake_amount?: number | null
          stake_currency?: string | null
          status?: string
          winner_id?: string | null
        }
        Update: {
          admin_note?: string | null
          challenger_id?: string
          challenger_paid?: boolean
          challenger_paystack_reference?: string | null
          completed_at?: string | null
          created_at?: string
          game_code?: string | null
          id?: string
          opponent_id?: string
          opponent_paid?: boolean
          opponent_paystack_reference?: string | null
          score_challenger?: number | null
          score_opponent?: number | null
          stake_amount?: number | null
          stake_currency?: string | null
          status?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "friendly_matches_challenger_id_fkey"
            columns: ["challenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendly_matches_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendly_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friends: {
        Row: {
          created_at: string
          id: string
          recipient_id: string
          requester_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_id: string
          requester_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_id?: string
          requester_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_interest: {
        Row: {
          created_at: string
          game_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_interest_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_interest_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          active: boolean
          category: string
          created_at: string
          icon_url: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          icon_url?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          category?: string
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
      homepage_banners: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          image_url: string
          link_url: string
          title: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          image_url: string
          link_url: string
          title: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          id?: string
          image_url?: string
          link_url?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "homepage_banners_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_images: {
        Row: {
          created_at: string
          display_order: number
          id: string
          image_url: string
          listing_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          image_url: string
          listing_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          image_url?: string
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_images_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
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
          game_id: string | null
          id: string
          price: number
          seller_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          currency?: string
          description?: string | null
          game_id?: string | null
          id?: string
          price: number
          seller_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          currency?: string
          description?: string | null
          game_id?: string | null
          id?: string
          price?: number
          seller_id?: string
          status?: string
          title?: string
          updated_at?: string
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
      marketplace_orders: {
        Row: {
          amount: number
          buyer_id: string
          created_at: string
          id: string
          listing_id: string
          listing_title: string
          seller_id: string
          status: string
          updated_at: string
          zolarux_order_id: string
          zolarux_order_ref: string
        }
        Insert: {
          amount: number
          buyer_id: string
          created_at?: string
          id?: string
          listing_id: string
          listing_title: string
          seller_id: string
          status?: string
          updated_at?: string
          zolarux_order_id: string
          zolarux_order_ref: string
        }
        Update: {
          amount?: number
          buyer_id?: string
          created_at?: string
          id?: string
          listing_id?: string
          listing_title?: string
          seller_id?: string
          status?: string
          updated_at?: string
          zolarux_order_id?: string
          zolarux_order_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_check_ins: {
        Row: {
          checked_in_at: string
          id: string
          match_id: string
          player_id: string
        }
        Insert: {
          checked_in_at?: string
          id?: string
          match_id: string
          player_id: string
        }
        Update: {
          checked_in_at?: string
          id?: string
          match_id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_check_ins_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_check_ins_player_id_fkey"
            columns: ["player_id"]
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
      match_wagers: {
        Row: {
          bettor_id: string
          created_at: string
          id: string
          match_id: string
          payout_coins: number | null
          pick_player_id: string
          stake_coins: number
          status: string
          updated_at: string
        }
        Insert: {
          bettor_id: string
          created_at?: string
          id?: string
          match_id: string
          payout_coins?: number | null
          pick_player_id: string
          stake_coins: number
          status?: string
          updated_at?: string
        }
        Update: {
          bettor_id?: string
          created_at?: string
          id?: string
          match_id?: string
          payout_coins?: number | null
          pick_player_id?: string
          stake_coins?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_wagers_bettor_id_fkey"
            columns: ["bettor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_wagers_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_wagers_pick_player_id_fkey"
            columns: ["pick_player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          admin_note: string | null
          auto_expired: boolean
          completed_at: string | null
          created_at: string
          group_id: string | null
          id: string
          is_full_day: boolean
          noshow_flagged_at: string | null
          player_a_id: string | null
          player_b_id: string | null
          replay_url: string | null
          resolution: string | null
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
          auto_expired?: boolean
          completed_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          is_full_day?: boolean
          noshow_flagged_at?: string | null
          player_a_id?: string | null
          player_b_id?: string | null
          replay_url?: string | null
          resolution?: string | null
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
          auto_expired?: boolean
          completed_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          is_full_day?: boolean
          noshow_flagged_at?: string | null
          player_a_id?: string | null
          player_b_id?: string | null
          replay_url?: string | null
          resolution?: string | null
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
      notifications: {
        Row: {
          body: string
          channel: string
          created_at: string
          dedupe_key: string
          error: string | null
          id: string
          player_id: string
          provider_reference: string | null
          sent_at: string | null
          status: string
          template_name: string
          to_number: string | null
          type: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          dedupe_key: string
          error?: string | null
          id?: string
          player_id: string
          provider_reference?: string | null
          sent_at?: string | null
          status: string
          template_name: string
          to_number?: string | null
          type: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          dedupe_key?: string
          error?: string | null
          id?: string
          player_id?: string
          provider_reference?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string
          to_number?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      phone_verifications: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          phone: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_coin_reserve: {
        Row: {
          coins: number
          created_at: string
          id: string
          match_id: string | null
          source: string
        }
        Insert: {
          coins: number
          created_at?: string
          id?: string
          match_id?: string | null
          source?: string
        }
        Update: {
          coins?: number
          created_at?: string
          id?: string
          match_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_coin_reserve_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      player_achievements: {
        Row: {
          achievement_id: string
          id: string
          player_id: string
          unlocked_at: string
        }
        Insert: {
          achievement_id: string
          id?: string
          player_id: string
          unlocked_at?: string
        }
        Update: {
          achievement_id?: string
          id?: string
          player_id?: string
          unlocked_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_achievements_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_challenge_progress: {
        Row: {
          challenge_id: string
          completed: boolean
          id: string
          player_id: string
          progress: number
          rewarded_at: string | null
          week_start: string
        }
        Insert: {
          challenge_id: string
          completed?: boolean
          id?: string
          player_id: string
          progress?: number
          rewarded_at?: string | null
          week_start: string
        }
        Update: {
          challenge_id?: string
          completed?: boolean
          id?: string
          player_id?: string
          progress?: number
          rewarded_at?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_challenge_progress_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "community_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_challenge_progress_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_kyc: {
        Row: {
          kyc_failure_reason: string | null
          kyc_status: string
          payout_account_name: string | null
          payout_account_number: string | null
          payout_bank_code: string | null
          payout_bank_name: string | null
          paystack_customer_code: string | null
          paystack_recipient_code: string | null
          player_id: string
          updated_at: string
        }
        Insert: {
          kyc_failure_reason?: string | null
          kyc_status?: string
          payout_account_name?: string | null
          payout_account_number?: string | null
          payout_bank_code?: string | null
          payout_bank_name?: string | null
          paystack_customer_code?: string | null
          paystack_recipient_code?: string | null
          player_id: string
          updated_at?: string
        }
        Update: {
          kyc_failure_reason?: string | null
          kyc_status?: string
          payout_account_name?: string | null
          payout_account_number?: string | null
          payout_bank_code?: string | null
          payout_bank_name?: string | null
          paystack_customer_code?: string | null
          paystack_recipient_code?: string | null
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_kyc_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link: string | null
          player_id: string
          read: boolean
          title: string
          type: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          link?: string | null
          player_id: string
          read?: boolean
          title: string
          type: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link?: string | null
          player_id?: string
          read?: boolean
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_notifications_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_store_items: {
        Row: {
          equipped: boolean
          id: string
          item_id: string
          player_id: string
          purchased_at: string
        }
        Insert: {
          equipped?: boolean
          id?: string
          item_id: string
          player_id: string
          purchased_at?: string
        }
        Update: {
          equipped?: boolean
          id?: string
          item_id?: string
          player_id?: string
          purchased_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_store_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "store_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_store_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          is_deleted: boolean
          post_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          post_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          id: string
          player_id: string
          post_id: string
          reaction: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          post_id: string
          reaction: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          post_id?: string
          reaction?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          country: string | null
          created_at: string
          display_name: string | null
          goals_conceded: number
          goals_scored: number
          id: string
          kyc_verified: boolean
          last_login_date: string | null
          login_streak: number
          losses: number
          membership_tier: string
          notification_prefs: Json
          phone: string | null
          phone_verified_at: string | null
          referred_by: string | null
          sentinel_tier: string | null
          sx_score: number
          total_matches: number
          total_titles: number
          updated_at: string
          username: string | null
          username_changed_at: string | null
          whatsapp_number: string | null
          wins: number
          xp: number
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          goals_conceded?: number
          goals_scored?: number
          id: string
          kyc_verified?: boolean
          last_login_date?: string | null
          login_streak?: number
          losses?: number
          membership_tier?: string
          notification_prefs?: Json
          phone?: string | null
          phone_verified_at?: string | null
          referred_by?: string | null
          sentinel_tier?: string | null
          sx_score?: number
          total_matches?: number
          total_titles?: number
          updated_at?: string
          username?: string | null
          username_changed_at?: string | null
          whatsapp_number?: string | null
          wins?: number
          xp?: number
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          goals_conceded?: number
          goals_scored?: number
          id?: string
          kyc_verified?: boolean
          last_login_date?: string | null
          login_streak?: number
          losses?: number
          membership_tier?: string
          notification_prefs?: Json
          phone?: string | null
          phone_verified_at?: string | null
          referred_by?: string | null
          sentinel_tier?: string | null
          sx_score?: number
          total_matches?: number
          total_titles?: number
          updated_at?: string
          username?: string | null
          username_changed_at?: string | null
          whatsapp_number?: string | null
          wins?: number
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          coins_awarded: number | null
          converted_at: string | null
          created_at: string
          id: string
          referred_id: string
          referrer_id: string
          status: string
        }
        Insert: {
          coins_awarded?: number | null
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_id: string
          referrer_id: string
          status?: string
        }
        Update: {
          coins_awarded?: number | null
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_id?: string
          referrer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      season_noshow_penalties: {
        Row: {
          created_at: string
          id: string
          match_id: string
          player_id: string
          points: number
          season_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          player_id: string
          points?: number
          season_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          player_id?: string
          points?: number
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_noshow_penalties_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_noshow_penalties_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_noshow_penalties_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_ranking_points: {
        Row: {
          awarded_at: string
          id: string
          placement: number | null
          player_id: string
          points: number
          season_id: string
          tournament_id: string
        }
        Insert: {
          awarded_at?: string
          id?: string
          placement?: number | null
          player_id: string
          points?: number
          season_id: string
          tournament_id: string
        }
        Update: {
          awarded_at?: string
          id?: string
          placement?: number | null
          player_id?: string
          points?: number
          season_id?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_ranking_points_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_ranking_points_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_ranking_points_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          end_date: string
          id: string
          name: string
          slug: string
          start_date: string
          status: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          name: string
          slug: string
          start_date: string
          status?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          name?: string
          slug?: string
          start_date?: string
          status?: string
        }
        Relationships: []
      }
      store_items: {
        Row: {
          active: boolean
          category: string
          created_at: string
          description: string | null
          id: string
          name: string
          preview_url: string | null
          price_coins: number
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          preview_url?: string | null
          price_coins: number
          slug: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          preview_url?: string | null
          price_coins?: number
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      sx_coin_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          player_id: string
          reference_id: string | null
          source: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          player_id: string
          reference_id?: string | null
          source: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          player_id?: string
          reference_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "sx_coin_transactions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sx_coins: {
        Row: {
          balance: number
          player_id: string
          total_earned: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          balance?: number
          player_id: string
          total_earned?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          balance?: number
          player_id?: string
          total_earned?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sx_coins_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sx_score_events: {
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
      tournament_fee_waivers: {
        Row: {
          granted_at: string
          granted_by: string
          id: string
          player_id: string
          reason: string | null
          redeemed_at: string | null
          tournament_id: string
        }
        Insert: {
          granted_at?: string
          granted_by: string
          id?: string
          player_id: string
          reason?: string | null
          redeemed_at?: string | null
          tournament_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          id?: string
          player_id?: string
          reason?: string | null
          redeemed_at?: string | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_fee_waivers_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_fee_waivers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_fee_waivers_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_invitations: {
        Row: {
          expires_at: string
          id: string
          invited_at: string
          player_id: string
          rank_at_invite: number
          responded_at: string | null
          status: string
          tournament_id: string
        }
        Insert: {
          expires_at: string
          id?: string
          invited_at?: string
          player_id: string
          rank_at_invite: number
          responded_at?: string | null
          status?: string
          tournament_id: string
        }
        Update: {
          expires_at?: string
          id?: string
          invited_at?: string
          player_id?: string
          rank_at_invite?: number
          responded_at?: string | null
          status?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_invitations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_invitations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_registrations: {
        Row: {
          coin_discount_naira: number
          coins_used: number
          disqualification_note: string | null
          disqualified_at: string | null
          fee_waived: boolean
          id: string
          payment_status: string
          paystack_reference: string | null
          player_id: string
          reg_club_name: string | null
          reg_display_name: string | null
          reg_ign_tag: string | null
          reg_whatsapp: string | null
          registered_at: string
          replaces_registration_id: string | null
          status: string
          tournament_id: string
        }
        Insert: {
          coin_discount_naira?: number
          coins_used?: number
          disqualification_note?: string | null
          disqualified_at?: string | null
          fee_waived?: boolean
          id?: string
          payment_status?: string
          paystack_reference?: string | null
          player_id: string
          reg_club_name?: string | null
          reg_display_name?: string | null
          reg_ign_tag?: string | null
          reg_whatsapp?: string | null
          registered_at?: string
          replaces_registration_id?: string | null
          status?: string
          tournament_id: string
        }
        Update: {
          coin_discount_naira?: number
          coins_used?: number
          disqualification_note?: string | null
          disqualified_at?: string | null
          fee_waived?: boolean
          id?: string
          payment_status?: string
          paystack_reference?: string | null
          player_id?: string
          reg_club_name?: string | null
          reg_display_name?: string | null
          reg_ign_tag?: string | null
          reg_whatsapp?: string | null
          registered_at?: string
          replaces_registration_id?: string | null
          status?: string
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
            foreignKeyName: "tournament_registrations_replaces_registration_id_fkey"
            columns: ["replaces_registration_id"]
            isOneToOne: false
            referencedRelation: "tournament_registrations"
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
          data_support_text: string | null
          data_support_whatsapp: string | null
          description: string | null
          format: string
          game_id: string
          id: string
          invitation_only: boolean
          max_players: number | null
          prize_pool: number
          registration_end: string | null
          registration_fee: number
          registration_start: string | null
          round_gap_days: number
          round_start_date: string | null
          rules: string | null
          season_id: string | null
          slug: string
          status: string
          title: string
          tournament_end: string | null
          tournament_start: string | null
          tournament_type: string
          updated_at: string
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          data_support_text?: string | null
          data_support_whatsapp?: string | null
          description?: string | null
          format?: string
          game_id: string
          id?: string
          invitation_only?: boolean
          max_players?: number | null
          prize_pool?: number
          registration_end?: string | null
          registration_fee?: number
          registration_start?: string | null
          round_gap_days?: number
          round_start_date?: string | null
          rules?: string | null
          season_id?: string | null
          slug: string
          status?: string
          title: string
          tournament_end?: string | null
          tournament_start?: string | null
          tournament_type?: string
          updated_at?: string
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          data_support_text?: string | null
          data_support_whatsapp?: string | null
          description?: string | null
          format?: string
          game_id?: string
          id?: string
          invitation_only?: boolean
          max_players?: number | null
          prize_pool?: number
          registration_end?: string | null
          registration_fee?: number
          registration_start?: string | null
          round_gap_days?: number
          round_start_date?: string | null
          rules?: string | null
          season_id?: string | null
          slug?: string
          status?: string
          title?: string
          tournament_end?: string | null
          tournament_start?: string | null
          tournament_type?: string
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
          {
            foreignKeyName: "tournaments_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
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
      wallet_deposits: {
        Row: {
          amount: number
          created_at: string
          fee: number
          id: string
          paystack_reference: string
          player_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          fee: number
          id?: string
          paystack_reference: string
          player_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          fee?: number
          id?: string
          paystack_reference?: string
          player_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_deposits_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          id: string
          note: string | null
          player_id: string
          reference_id: string | null
          type: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          id?: string
          note?: string | null
          player_id: string
          reference_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          id?: string
          note?: string | null
          player_id?: string
          reference_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          player_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          player_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
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
      xp_events: {
        Row: {
          created_at: string
          id: string
          player_id: string
          reference_id: string | null
          source: string
          xp: number
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          reference_id?: string | null
          source: string
          xp: number
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          reference_id?: string | null
          source?: string
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_events_player_id_fkey"
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
      expire_full_day_matches: { Args: never; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      jsonb_merge_notification_prefs: {
        Args: { p_id: string; p_key: string; p_patch: Json }
        Returns: undefined
      }
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
