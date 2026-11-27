import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommentDto, CreateThreadDto, UpdateThreadDto } from './forum.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

const validThread = { title: 'Grant query', body: 'x'.repeat(20), categorySlug: 'ulb-queries' };

describe('forum DTOs', () => {
  describe('text limits use the schema measure (UTF-16 code units)', () => {
    it('accepts ASCII titles at both boundaries', async () => {
      expect(await errorsOf(CreateThreadDto, { ...validThread, title: 'x'.repeat(5) })).toEqual([]);
      expect(await errorsOf(CreateThreadDto, { ...validThread, title: 'x'.repeat(140) })).toEqual([]);
    });

    it('rejects a title the schema would refuse: 139 letters + one emoji is 141 code units', async () => {
      const title = `${'x'.repeat(139)}😀`;
      expect(title.length).toBe(141);
      expect(await errorsOf(CreateThreadDto, { ...validThread, title })).toEqual(['title']);
    });

    it('applies the same measure to thread and reply bodies', async () => {
      const body = `${'x'.repeat(19_999)}😀`; // 20,001 code units
      expect(await errorsOf(CreateThreadDto, { ...validThread, body })).toEqual(['body']);
      expect(await errorsOf(CreateCommentDto, { body: `${'x'.repeat(9_999)}😀` })).toEqual(['body']);
      expect(await errorsOf(CreateCommentDto, { body: 'x'.repeat(10_000) })).toEqual([]);
    });
  });

  describe('category slugs match what category management allows', () => {
    it('accepts a one-character slug in create and update', async () => {
      expect(await errorsOf(CreateThreadDto, { ...validThread, categorySlug: 'a' })).toEqual([]);
      expect(await errorsOf(UpdateThreadDto, { categorySlug: 'a' })).toEqual([]);
    });

    it('still rejects invalid slugs', async () => {
      expect(await errorsOf(CreateThreadDto, { ...validThread, categorySlug: 'Not Valid' })).toEqual(['categorySlug']);
      expect(await errorsOf(UpdateThreadDto, { categorySlug: 'x'.repeat(61) })).toEqual(['categorySlug']);
    });
  });

  describe('UpdateThreadDto', () => {
    it('allows omitted fields (the stored value is kept)', async () => {
      expect(await errorsOf(UpdateThreadDto, {})).toEqual([]);
    });

    it('rejects an explicit null title, body or category', async () => {
      expect(await errorsOf(UpdateThreadDto, { title: null })).toEqual(['title']);
      expect(await errorsOf(UpdateThreadDto, { body: null })).toEqual(['body']);
      expect(await errorsOf(UpdateThreadDto, { categorySlug: null })).toEqual(['categorySlug']);
    });
  });
});
