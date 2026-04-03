import { TmdbSource } from './TmdbSource.ts';
import { ImdbSource } from './ImdbSource.ts';
import { AnilistSource } from './AnilistSource.ts';
import { MalSource } from './MalSource.ts';
import { SimklSource } from './SimklSource.ts';
import type { IDiscoverSource } from './types.ts';

const SOURCE_REGISTRY = new Map<string, IDiscoverSource>([
  ['tmdb', TmdbSource],
  ['imdb', ImdbSource],
  ['anilist', AnilistSource],
  ['mal', MalSource],
  ['simkl', SimklSource],
]);

export function getSource(id: string | undefined): IDiscoverSource {
  return SOURCE_REGISTRY.get(id ?? 'tmdb') ?? TmdbSource;
}

export function getAllSources(): IDiscoverSource[] {
  return Array.from(SOURCE_REGISTRY.values());
}
