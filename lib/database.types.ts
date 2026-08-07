export type MatchResult = 'white_wins' | 'black_wins' | 'draw' | 'pending'
export type Bracket = 'A' | 'B'
export type Role = 'player' | 'admin'

// Convenience row types for use throughout the app
export interface Profile {
  id: string
  email: string
  role: Role
  created_at: string
}

export interface Player {
  id: string
  user_id: string
  chess_com_username: string
  display_name: string
  bracket: Bracket | null
  created_at: string
}

export interface Season {
  id: string
  name: string
  start_date: string
  end_date: string | null
  is_active: boolean
  is_finished: boolean
  created_at: string
}

export interface Match {
  id: string
  season_id: string
  bracket: Bracket
  week_number: number
  white_player_id: string
  black_player_id: string
  scheduled_start: string
  scheduled_end: string
  result: MatchResult
  chess_com_game_url: string | null
  last_checked_at: string | null
  created_at: string
}

export interface MatchWithPlayers extends Match {
  white_player: Pick<Player, 'id' | 'display_name' | 'chess_com_username'>
  black_player: Pick<Player, 'id' | 'display_name' | 'chess_com_username'>
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; role: Role; created_at: string }
        Insert: { id: string; email: string; role?: Role }
        Update: { role?: Role }
      }
      players: {
        Row: {
          id: string
          user_id: string
          chess_com_username: string
          display_name: string
          bracket: Bracket | null
          created_at: string
        }
        Insert: {
          user_id: string
          chess_com_username: string
          display_name: string
          bracket?: Bracket | null
        }
        Update: {
          chess_com_username?: string
          display_name?: string
          bracket?: Bracket | null
        }
      }
      seasons: {
        Row: {
          id: string
          name: string
          start_date: string
          end_date: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          name: string
          start_date: string
          end_date?: string | null
          is_active?: boolean
        }
        Update: { name?: string; start_date?: string; end_date?: string | null; is_active?: boolean }
      }
      matches: {
        Row: {
          id: string
          season_id: string
          bracket: Bracket
          week_number: number
          white_player_id: string
          black_player_id: string
          scheduled_start: string
          scheduled_end: string
          result: MatchResult
          chess_com_game_url: string | null
          last_checked_at: string | null
          created_at: string
        }
        Insert: {
          season_id: string
          bracket: Bracket
          week_number: number
          white_player_id: string
          black_player_id: string
          scheduled_start: string
          scheduled_end: string
          result?: MatchResult
        }
        Update: {
          result?: MatchResult
          chess_com_game_url?: string | null
          last_checked_at?: string | null
          bracket?: Bracket
        }
      }
    }
  }
}
