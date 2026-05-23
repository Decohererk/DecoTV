export type TmdbMediaType = 'movie' | 'tv';

export interface TmdbImageSet {
  posters: Array<{
    file_path: string;
    iso_639_1: string | null;
    width: number;
    height: number;
    vote_average: number;
  }>;
  backdrops: Array<{
    file_path: string;
    iso_639_1: string | null;
    width: number;
    height: number;
    vote_average: number;
  }>;
}

export interface TmdbCreditSet {
  cast: Array<{
    id: number;
    name: string;
    character?: string;
    profile_path: string | null;
  }>;
  crew: Array<{
    id: number;
    name: string;
    job?: string;
    department?: string;
    profile_path: string | null;
  }>;
}

export interface TmdbMovieDetail {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  runtime: number;
  status: string;
  original_language: string;
  genres: Array<{ id: number; name: string }>;
  production_countries: Array<{ iso_3166_1: string; name: string }>;
  spoken_languages: Array<{ iso_639_1: string; name: string }>;
}

export interface TmdbTvDetail {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  status: string;
  original_language: string;
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  origin_country: string[];
  genres: Array<{ id: number; name: string }>;
  production_countries: Array<{ iso_3166_1: string; name: string }>;
  spoken_languages: Array<{ iso_639_1: string; name: string }>;
}

export interface TmdbEpisodeDetail {
  id: number;
  name: string;
  overview: string;
  still_path: string | null;
  air_date: string;
  season_number: number;
  episode_number: number;
}

export interface TmdbSearchResult<T = unknown> {
  page: number;
  total_pages: number;
  total_results: number;
  results: T[];
}

export interface TmdbSearchMediaResult {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
  original_language?: string;
  origin_country?: string[];
}
