export type MatchResult = 'white_wins' | 'black_wins' | 'draw' | 'pending'
export type Bracket = 'A' | 'B' | 'C' | 'D'
export type Role = 'player' | 'admin'

/** Playoff structure of a tournament (or of one division within it). */
export type TournamentFormat =
  | 'single_elim'
  | 'double_elim'
  | 'round_robin'
  | 'random_wheel'
  | 'mixed'

/** Which side of the draw a playoff match sits on. */
export type BracketKind = 'championship' | 'consolation' | 'winners' | 'losers'

/** A division key within a tournament or season. Free text, not A-D: the
 *  historic data uses city names (tournament 3's group stage) and qualified
 *  names like "A (Bogdan)" (tournament 10) or "B (X)" (tournament 12). */
export type DivisionKey = string

// Convenience row types for use throughout the app
export interface Profile {
  id: string
  email: string
  role: Role
  created_at: string
}

export interface Player {
  id: string
  /** null for a historic player who never had an account. */
  user_id: string | null
  /** null for a historic player known only by first name. */
  chess_com_username: string | null
  display_name: string
  bracket: Bracket | null
  is_historic: boolean
  created_at: string
}

export interface Season {
  id: string
  name: string
  /** Sequence number (1..15 for the imported history); null for ad-hoc seasons. */
  number: number | null
  /** null for historic league phases, which were never dated. */
  start_date: string | null
  end_date: string | null
  is_active: boolean
  is_finished: boolean
  is_historic: boolean
  is_hidden: boolean
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

/** A match with its (0 or 1) imported chess.com game -- carries format
 *  (rules/time_control) and the list of players who've starred it, for the
 *  schedule page's format badge and star count. */
export interface MatchWithPlayersAndGame extends MatchWithPlayers {
  games: (Pick<Game, 'id' | 'rules' | 'time_control'> & { game_stars: Pick<GameStar, 'player_id'>[] })[]
}

/** A player's row in a season's final league table. Stored rather than derived,
 *  because historic league data survives only in aggregate. */
export interface SeasonStanding {
  id: string
  season_id: string
  division: DivisionKey
  player_id: string
  rank: number
  wins: number
  draws: number
  losses: number
  points: number
  created_at: string
}

/** The playoff event that ends a season. season_id is null for the standalone
 *  tournaments that had no league phase behind them. */
export interface Tournament {
  id: string
  season_id: string | null
  number: number
  name: string
  format: TournamentFormat
  start_date: string | null
  end_date: string | null
  is_active: boolean
  is_finished: boolean
  is_hidden: boolean
  notes: string | null
  created_at: string
}

export interface TournamentDivision {
  id: string
  tournament_id: string
  division: DivisionKey
  format: TournamentFormat
  created_at: string
}

export interface TournamentEntrant {
  id: string
  tournament_id: string
  /** null for a tournament that was not split into divisions. */
  division: DivisionKey | null
  /** Which bracket this entry and its placement belong to. A division can hold
   *  a championship and a consolation, each with its own 1st place. */
  bracket_kind: BracketKind
  player_id: string
  seed: number | null
  final_placement: number | null
  /** Record from a group phase within the playoff, where one was played
   *  (tournament 3). null for a straight knockout entrant. */
  wins: number | null
  draws: number | null
  losses: number | null
  points: number | null
  created_at: string
}

/** A playoff match: a race to N games between two seeds, with no fixed colour.
 *  Distinct from Match, which is a single league game with white/black. */
export interface TournamentMatch {
  id: string
  tournament_id: string
  division: DivisionKey | null
  bracket_kind: BracketKind
  round: number
  slot: number
  /** Either side may be null: an unplayed slot, or a bye. */
  player_a_id: string | null
  player_b_id: string | null
  seed_a: number | null
  seed_b: number | null
  score_a: number | null
  score_b: number | null
  winner_id: string | null
  is_medal_game: boolean
  label: string | null
  next_match_id: string | null
  created_at: string
}

type EntrantPlayer = Pick<Player, 'id' | 'display_name' | 'chess_com_username'>

export interface TournamentMatchWithPlayers extends TournamentMatch {
  player_a: EntrantPlayer | null
  player_b: EntrantPlayer | null
}

export interface TournamentEntrantWithPlayer extends TournamentEntrant {
  player: EntrantPlayer
}

export interface SeasonStandingWithPlayer extends SeasonStanding {
  player: EntrantPlayer
}

/** A single chess.com game imported for a league match or a tournament match
 *  game. Exactly one of match_id/tournament_match_id is set. `stats` holds the
 *  shape produced by lib/pgn.ts's parseGameStats(). */
export interface Game {
  id: string
  match_id: string | null
  tournament_match_id: string | null
  white_player_id: string
  black_player_id: string
  chess_com_url: string
  pgn: string
  result: MatchResult
  time_control: string | null
  rules: string | null
  time_class: string | null
  ply_count: number
  end_time: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stats: any
  created_at: string
}

/** One player's star vote on a game. Any player may star any game -- the
 *  count is just the number of these rows for that game_id. */
export interface GameStar {
  id: string
  game_id: string
  player_id: string
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; role: Role; created_at: string }
        Insert: { id: string; email: string; role?: Role }
        Update: { role?: Role }
      }
      // Row types reuse the interfaces above so the two cannot drift apart.
      players: {
        Row: Player
        Insert: {
          user_id?: string | null
          chess_com_username?: string | null
          display_name: string
          bracket?: Bracket | null
          is_historic?: boolean
        }
        Update: {
          user_id?: string | null
          chess_com_username?: string | null
          display_name?: string
          bracket?: Bracket | null
          is_historic?: boolean
        }
      }
      seasons: {
        Row: Season
        Insert: {
          name: string
          number?: number | null
          start_date?: string | null
          end_date?: string | null
          is_active?: boolean
          is_finished?: boolean
          is_historic?: boolean
        }
        Update: {
          name?: string
          number?: number | null
          start_date?: string | null
          end_date?: string | null
          is_active?: boolean
          is_finished?: boolean
          is_historic?: boolean
        }
      }
      matches: {
        Row: Match
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
      season_standings: {
        Row: SeasonStanding
        Insert: {
          season_id: string
          division: DivisionKey
          player_id: string
          rank: number
          wins?: number
          draws?: number
          losses?: number
          points?: number
        }
        Update: {
          rank?: number
          wins?: number
          draws?: number
          losses?: number
          points?: number
        }
      }
      tournaments: {
        Row: Tournament
        Insert: {
          season_id?: string | null
          number: number
          name: string
          format: TournamentFormat
          start_date?: string | null
          end_date?: string | null
          is_active?: boolean
          is_finished?: boolean
          notes?: string | null
        }
        Update: {
          season_id?: string | null
          name?: string
          format?: TournamentFormat
          start_date?: string | null
          end_date?: string | null
          is_active?: boolean
          is_finished?: boolean
          notes?: string | null
        }
      }
      tournament_divisions: {
        Row: TournamentDivision
        Insert: { tournament_id: string; division: DivisionKey; format: TournamentFormat }
        Update: { format?: TournamentFormat }
      }
      tournament_entrants: {
        Row: TournamentEntrant
        Insert: {
          tournament_id: string
          division?: DivisionKey | null
          bracket_kind?: BracketKind
          player_id: string
          seed?: number | null
          final_placement?: number | null
          wins?: number | null
          draws?: number | null
          losses?: number | null
          points?: number | null
        }
        Update: {
          seed?: number | null
          final_placement?: number | null
          wins?: number | null
          draws?: number | null
          losses?: number | null
          points?: number | null
        }
      }
      tournament_matches: {
        Row: TournamentMatch
        Insert: {
          tournament_id: string
          division?: DivisionKey | null
          bracket_kind?: BracketKind
          round: number
          slot: number
          player_a_id?: string | null
          player_b_id?: string | null
          seed_a?: number | null
          seed_b?: number | null
          score_a?: number | null
          score_b?: number | null
          winner_id?: string | null
          is_medal_game?: boolean
          label?: string | null
          next_match_id?: string | null
        }
        Update: {
          player_a_id?: string | null
          player_b_id?: string | null
          seed_a?: number | null
          seed_b?: number | null
          score_a?: number | null
          score_b?: number | null
          winner_id?: string | null
          is_medal_game?: boolean
          label?: string | null
          next_match_id?: string | null
        }
      }
      games: {
        Row: Game
        Insert: {
          match_id?: string | null
          tournament_match_id?: string | null
          white_player_id: string
          black_player_id: string
          chess_com_url: string
          pgn: string
          result: MatchResult
          time_control?: string | null
          rules?: string | null
          time_class?: string | null
          ply_count: number
          end_time: string
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stats: any
        }
        Update: object
      }
      game_stars: {
        Row: GameStar
        Insert: { game_id: string; player_id: string }
        Update: object
      }
    }
  }
}
