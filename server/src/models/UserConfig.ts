import mongoose from 'mongoose';
import crypto from 'crypto';

// Catalog subdocument schema
const catalogSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      default: () => crypto.randomUUID(),
    },
    name: { type: String, required: true },
    type: { type: String, enum: ['movie', 'series'], required: true },
    source: { type: String, enum: ['tmdb', 'imdb'], default: 'tmdb' },
    filters: {
      listType: { type: String, default: 'discover' },
      genres: [Number],
      excludeGenres: [Number],
      genreMatchMode: { type: String, default: 'any' }, // 'any' (OR) or 'all' (AND)
      yearFrom: Number,
      yearTo: Number,
      ratingMin: Number,
      ratingMax: Number,
      sortBy: { type: String, default: 'popularity.desc' },
      language: String,
      displayLanguage: String,
      countries: String,
      region: String, // Release region (e.g. for release dates)
      includeAdult: { type: Boolean, default: false },
      discoverOnly: { type: Boolean, default: false },
      randomize: { type: Boolean, default: false },
      imdbOnly: { type: Boolean, default: true },
      voteCountMin: { type: Number, default: 0 },
      runtimeMin: Number,
      runtimeMax: Number,
      releaseDateFrom: String,
      releaseDateTo: String,
      releaseType: Number,
      releaseTypes: [Number],
      certification: String,
      certifications: [String],
      certificationCountry: String,
      airDateFrom: String,
      airDateTo: String,
      datePreset: String, // Dynamic date preset e.g. 'last_30_days', 'this_year'
      withNetworks: String,
      tvStatus: String,
      tvType: String,
      withCast: String,
      withCrew: String,
      withPeople: String,
      withCompanies: String,
      withKeywords: String,
      excludeKeywords: String,
      watchRegion: String,
      watchProviders: [Number],
      watchMonetizationType: String,
      watchMonetizationTypes: [String],
      // IMDb-specific filters
      imdbListId: String,
      query: String,
      sortOrder: String,
      imdbRatingMin: Number,
      totalVotesMin: Number,
      releaseDateStart: String,
      releaseDateEnd: String,
      languages: [String],
      imdbCountries: [String],
      keywords: [String],
      awardsWon: Number,
      awardsNominated: Number,
      types: [String],
    },
    enabled: { type: Boolean, default: true },
    formState: { type: mongoose.Schema.Types.Mixed },
  },
  {
    _id: false,
    strict: false,
  }
);

// IMDB dataset catalog subdocument schema
const imdbCatalogSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      default: () => crypto.randomUUID(),
    },
    name: { type: String, required: true },
    type: { type: String, enum: ['movie', 'series'], required: true },
    filters: {
      genre: String,
      decadeStart: Number,
      decadeEnd: Number,
      sortBy: { type: String, default: 'rating' },
      sortOrder: { type: String, default: 'desc' },
      ratingMin: Number,
      ratingMax: Number,
      votesMin: Number,
    },
    enabled: { type: Boolean, default: true },
  },
  {
    _id: false,
    strict: true,
  }
);

const userConfigSchema = new mongoose.Schema({
  // Unique user identifier (short, URL-friendly)
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // User-defined name for this configuration
  configName: {
    type: String,
    default: '',
  },
  // HMAC-SHA256 hash of the TMDB API key for fast lookups
  apiKeyId: {
    type: String,
    required: false,
    index: true,
  },

  // User's TMDB API key (encrypted with AES-256-GCM)
  tmdbApiKeyEncrypted: {
    type: String,
    required: false,
  },
  // Array of custom catalogs
  catalogs: [catalogSchema],
  // Array of IMDB dataset catalogs
  imdbCatalogs: [imdbCatalogSchema],
  // Preferences
  preferences: {
    showAdultContent: { type: Boolean, default: false },
    defaultLanguage: { type: String, default: 'en' },
    shuffleCatalogs: { type: Boolean, default: false },
    // Poster enhancement service (RPDB or Top Posters)
    posterService: {
      type: String,
      enum: ['none', 'rpdb', 'topPosters'],
      default: 'none',
    },
    // Encrypted API key for the selected poster service
    posterApiKeyEncrypted: { type: String, required: false },
    // Option to disable search catalogs
    disableSearch: { type: Boolean, default: false },
  },
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Update timestamp on save
userConfigSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export const UserConfig = mongoose.model('UserConfig', userConfigSchema);
