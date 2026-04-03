export const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  type
  format
  status
  description(asHtml: false)
  startDate { year month day }
  endDate { year month day }
  season
  seasonYear
  episodes
  duration
  countryOfOrigin
  source
  coverImage { extraLarge large medium color }
  bannerImage
  genres
  tags { id name rank category isAdult }
  averageScore
  meanScore
  popularity
  trending
  favourites
  isAdult
  studios { nodes { id name isAnimationStudio } }
  nextAiringEpisode { airingAt episode timeUntilAiring }
  trailer { id site thumbnail }
  siteUrl
`;

export const BROWSE_QUERY = `
  query ($page: Int, $perPage: Int, $sort: [MediaSort], $type: MediaType, $format_in: [MediaFormat], $status_in: [MediaStatus], $season: MediaSeason, $seasonYear: Int, $genre_in: [String], $genre_not_in: [String], $tag_in: [String], $tag_not_in: [String], $averageScore_greater: Int, $averageScore_lesser: Int, $popularity_greater: Int, $episodes_greater: Int, $episodes_lesser: Int, $duration_greater: Int, $duration_lesser: Int, $countryOfOrigin: CountryCode, $source_in: [MediaSource], $isAdult: Boolean, $search: String) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total perPage currentPage lastPage hasNextPage }
      media(sort: $sort, type: $type, format_in: $format_in, status_in: $status_in, season: $season, seasonYear: $seasonYear, genre_in: $genre_in, genre_not_in: $genre_not_in, tag_in: $tag_in, tag_not_in: $tag_not_in, averageScore_greater: $averageScore_greater, averageScore_lesser: $averageScore_lesser, popularity_greater: $popularity_greater, episodes_greater: $episodes_greater, episodes_lesser: $episodes_lesser, duration_greater: $duration_greater, duration_lesser: $duration_lesser, countryOfOrigin: $countryOfOrigin, source_in: $source_in, isAdult: $isAdult, search: $search) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

export const SEARCH_QUERY = `
  query ($search: String!, $page: Int, $perPage: Int, $type: MediaType, $format_in: [MediaFormat]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total perPage currentPage lastPage hasNextPage }
      media(search: $search, type: $type, format_in: $format_in, sort: [SEARCH_MATCH]) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;
