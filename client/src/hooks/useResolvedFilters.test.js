import { describe, it, expect, vi } from 'vitest';
import { toPlaceholdersFromCsv, resolveItems } from './useResolvedFilters';

describe('toPlaceholdersFromCsv', () => {
  it('splits CSV into id/name pairs', () => {
    expect(toPlaceholdersFromCsv('1,2,3')).toEqual([
      { id: '1', name: '1' },
      { id: '2', name: '2' },
      { id: '3', name: '3' },
    ]);
  });

  it('returns empty for null/undefined/empty', () => {
    expect(toPlaceholdersFromCsv(null)).toEqual([]);
    expect(toPlaceholdersFromCsv(undefined)).toEqual([]);
    expect(toPlaceholdersFromCsv('')).toEqual([]);
  });

  it('supports custom separator', () => {
    expect(toPlaceholdersFromCsv('a|b|c', '|')).toEqual([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b' },
      { id: 'c', name: 'c' },
    ]);
  });

  it('filters empty segments', () => {
    expect(toPlaceholdersFromCsv('1,,3,')).toEqual([
      { id: '1', name: '1' },
      { id: '3', name: '3' },
    ]);
  });
});

describe('resolveItems', () => {
  it('returns empty/null inputs unchanged', async () => {
    expect(await resolveItems(null)).toBeNull();
    expect(await resolveItems([])).toEqual([]);
  });

  it('skips already-resolved items', async () => {
    const items = [{ id: '123', name: 'Tom Hanks' }];
    const fetchById = vi.fn();
    const result = await resolveItems(items, fetchById);
    expect(fetchById).not.toHaveBeenCalled();
    expect(result).toEqual(items);
  });

  it('resolves numeric-only names via fetchById', async () => {
    const items = [{ id: '123', name: '123' }];
    const fetchById = vi.fn().mockResolvedValue({ name: 'Tom Hanks' });
    const result = await resolveItems(items, fetchById);
    expect(result[0]).toEqual({ id: '123', name: 'Tom Hanks', logo: undefined });
    expect(fetchById).toHaveBeenCalledWith('123');
  });

  it('falls back to search when fetchById returns null', async () => {
    const items = [{ id: '99', name: '99' }];
    const fetchById = vi.fn().mockResolvedValue(null);
    const search = vi.fn().mockResolvedValue([{ name: 'Found Name' }]);
    const result = await resolveItems(items, fetchById, search);
    expect(result[0]).toEqual({ id: '99', name: 'Found Name', logo: undefined });
  });

  it('keeps placeholder when resolution fails', async () => {
    const items = [{ id: '42', name: '42' }];
    const fetchById = vi.fn().mockRejectedValue(new Error('fail'));
    const result = await resolveItems(items, fetchById);
    expect(result[0]).toEqual({ id: '42', name: '42' });
  });
});
