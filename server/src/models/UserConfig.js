import mongoose from 'mongoose';
import crypto from 'crypto';

// Catalog subdocument schema
// NOTE: We use a custom string _id (UUID from frontend), NOT Mongoose ObjectId
// The { _id: false } option ONLY disables auto-generation, not our custom _id field
const catalogSchema = new mongoose.Schema({
  // Custom string ID from frontend (UUID)
  // This is explicitly defined so it will be stored even with _id: false
  _id: { 
    type: String, 
    required: true,
    default: () => crypto.randomUUID()
  },
  name: { type: String, required: true },
  type: { type: String, enum: ['movie', 'series'], required: true },
  filters: {
    // List type (discover, trending_day, trending_week, etc.)
    listType: { type: String, default: 'discover' },
    // Basic filters
    genres: [Number],
    excludeGenres: [Number],
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
    // Movie-specific
    runtimeMin: Number,
    runtimeMax: Number,
    releaseDateFrom: String,
    releaseDateTo: String,
    releaseType: Number,
    releaseTypes: [Number],
    certification: String,
    certifications: [String],
    certificationCountry: String,
    // TV-specific
    airDateFrom: String,
    airDateTo: String,
    withNetworks: String,
    tvStatus: String,
    tvType: String,
    // People/Company/Keyword filters
    withCast: String,
    withCrew: String,
    withPeople: String,
    withCompanies: String,
    withKeywords: String,
    excludeKeywords: String,
    // Watch provider filters
    watchRegion: String,
    watchProviders: [Number],
    watchMonetizationType: String,
    watchMonetizationTypes: [String],
  },
  enabled: { type: Boolean, default: true },
}, { 
  _id: false, // Disable auto-generation of ObjectId - we use our own string _id
  strict: true, // Enforce schema
});

const userConfigSchema = new mongoose.Schema({
  // Unique user identifier (short, URL-friendly)
  userId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  // User's TMDB API key (encrypted in production)
  tmdbApiKey: { 
    type: String, 
    required: true 
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
userConfigSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export const UserConfig = mongoose.model('UserConfig', userConfigSchema);
