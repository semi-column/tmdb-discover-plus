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
      originCountry: String,
      includeAdult: { type: Boolean, default: false },
      imdbOnly: { type: Boolean, default: true },
      voteCountMin: { type: Number, default: 100 },
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
  // User's TMDB API key (legacy: unencrypted, for backward compatibility)
  tmdbApiKey: {
    type: String,
    required: false,
  },
  // User's TMDB API key (encrypted with AES-256-GCM)
  tmdbApiKeyEncrypted: {
    type: String,
    required: false,
  },
  // Array of custom catalogs
  catalogs: [catalogSchema],
  // Preferences
  preferences: {
    showAdultContent: { type: Boolean, default: false },
    defaultLanguage: { type: String, default: 'en' },
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
