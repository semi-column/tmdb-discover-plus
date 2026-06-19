import mongoose from 'mongoose';
import crypto from 'crypto';

const marketplaceEntrySchema = new mongoose.Schema(
  {
    marketplaceId: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID(),
    },
    provenance: {
      originUserId: { type: String, required: true, index: true },
      originCatalogId: { type: String, required: true },
      originConfigName: { type: String, default: '' },
    },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    tags: { type: [String], default: [], index: true },
    type: {
      type: String,
      enum: ['movie', 'series', 'anime', 'collection'],
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['tmdb', 'imdb', 'anilist', 'mal', 'simkl', 'trakt', 'kitsu'],
      required: true,
      index: true,
    },
    genres: { type: [String], default: [], index: true },
    filterFacets: { type: [String], default: [] },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    formState: { type: mongoose.Schema.Types.Mixed },
    visibility: {
      type: String,
      enum: ['public', 'unlisted', 'private'],
      default: 'public',
      index: true,
    },
    moderation: {
      type: String,
      enum: ['active', 'flagged', 'removed'],
      default: 'active',
      index: true,
    },
    engagement: {
      likes: { type: Number, default: 0, min: 0 },
      installs: { type: Number, default: 0, min: 0 },
      views: { type: Number, default: 0, min: 0 },
      trendingScore: { type: Number, default: 0, min: 0, index: true },
      lastEngagedAt: { type: Date },
    },
    contentHash: { type: String, required: true },
    publishedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    schemaVersion: { type: Number, default: 1 },
  },
  { strict: true }
);

// One entry per (author, catalog)
marketplaceEntrySchema.index(
  { 'provenance.originUserId': 1, 'provenance.originCatalogId': 1 },
  { unique: true }
);
// Full-text search over name/description/tags/genres (name weighted highest)
marketplaceEntrySchema.index(
  { name: 'text', description: 'text', tags: 'text', genres: 'text' },
  { weights: { name: 10, tags: 4, genres: 3, description: 1 }, name: 'marketplace_text' }
);
// Sort/filter support
marketplaceEntrySchema.index({ visibility: 1, moderation: 1, source: 1, type: 1 });
marketplaceEntrySchema.index({ visibility: 1, moderation: 1, 'engagement.installs': -1 });
marketplaceEntrySchema.index({ visibility: 1, moderation: 1, 'engagement.trendingScore': -1 });
marketplaceEntrySchema.index({ visibility: 1, moderation: 1, publishedAt: -1 });

export const MarketplaceEntryModel = mongoose.model('MarketplaceEntry', marketplaceEntrySchema);

const marketplaceLikeSchema = new mongoose.Schema({
  marketplaceId: { type: String, required: true },
  actorUserId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
marketplaceLikeSchema.index({ marketplaceId: 1, actorUserId: 1 }, { unique: true });
export const MarketplaceLikeModel = mongoose.model('MarketplaceLike', marketplaceLikeSchema);
