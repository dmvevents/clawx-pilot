// @vitest-environment node
/**
 * CLWX-143 topic/preview search: the shared predicate and the coverage
 * descriptor both transports report.
 *
 * Measured problem this locks down (installed 0.4.3-moe.41, run moe41f,
 * 2026-09-12): the acceptance prompt is "Search my inbox for emails about the
 * academic year", the assistant could only call a subject filter, and the one
 * message carrying the phrase in its preview line was silently dropped. The
 * fix is a topic filter that matches subject OR preview, plus a result that
 * says which text it compared instead of implying a full-text search.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_PREVIEW_CHAR_LIMIT,
  describeSearchCoverage,
  isSubjectFilterSupersededByTopic,
  matchesTopicText,
  normalizeTopicText,
  topicCoverageNote,
  validateSearchInboxTopicArg,
} from '@electron/services/outlook-browser/search-predicates';
import { parseInboxRowTexts } from '@electron/services/outlook-browser-v2/inbox-row-parser';

describe('normalizeTopicText', () => {
  it('case-folds, collapses whitespace and trims', () => {
    expect(normalizeTopicText('  Academic   Year \n')).toBe('academic year');
  });

  it('treats a non-breaking space as a space', () => {
    expect(normalizeTopicText('Academic Year')).toBe('academic year');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeTopicText(' \n\t')).toBe('');
  });
});

describe('matchesTopicText', () => {
  const subjectMatch = { subject: 'Reminder: 2026/2027 Academic Year calendar', snippet: 'See attached.' };
  // The sixth measured row: the phrase appears only in the preview line.
  const previewOnlyMatch = {
    subject: 'Welcome Back to a New School Year',
    snippet: 'Dear Colleagues, ... The new Academic Year begins on Monday ...',
  };
  const unrelated = { subject: 'Routine circular', snippet: 'Please acknowledge receipt.' };

  it('matches on the subject', () => {
    expect(matchesTopicText(subjectMatch, 'academic year')).toBe(true);
  });

  it('matches on preview text only, which a subject filter cannot see', () => {
    expect(matchesTopicText(previewOnlyMatch, 'academic year')).toBe(true);
  });

  it('excludes unrelated rows', () => {
    expect(matchesTopicText(unrelated, 'academic year')).toBe(false);
  });

  it('is case-insensitive in both directions', () => {
    expect(matchesTopicText(subjectMatch, 'ACADEMIC YEAR')).toBe(true);
    expect(matchesTopicText({ subject: 'ACADEMIC YEAR NOTICE', snippet: '' }, 'academic year')).toBe(true);
  });

  it('is whitespace-normalized across the topic and the row text', () => {
    expect(matchesTopicText(subjectMatch, 'academic   year')).toBe(true);
    expect(matchesTopicText({ subject: 'The academic year plan', snippet: '' }, 'academic year')).toBe(true);
    expect(matchesTopicText({ subject: 'The academic\nyear plan', snippet: '' }, 'academic year')).toBe(true);
  });

  it('treats a blank topic as no filter rather than as a match failure', () => {
    expect(matchesTopicText(unrelated, '')).toBe(true);
    expect(matchesTopicText(unrelated, '   ')).toBe(true);
  });

  it('tolerates rows with missing subject or preview fields', () => {
    expect(matchesTopicText({ subject: '', snippet: '' }, 'academic year')).toBe(false);
    expect(
      matchesTopicText({ subject: undefined, snippet: 'the academic year' } as never, 'academic year'),
    ).toBe(true);
  });
});

describe('describeSearchCoverage', () => {
  it('reports subject only for a subject filter', () => {
    expect(describeSearchCoverage({ subjectContains: 'academic year' }, { attachmentSignal: 'preview' })).toEqual({
      comparedFields: ['subject'],
      bodySearched: false,
    });
  });

  it('reports subject and preview for a topic filter', () => {
    expect(describeSearchCoverage({ topicContains: 'academic year' }, { attachmentSignal: 'preview' })).toEqual({
      comparedFields: ['subject', 'preview'],
      bodySearched: false,
    });
  });

  it('reports the sender when a from filter is supplied', () => {
    expect(
      describeSearchCoverage({ from: 'district', topicContains: 'academic year' }, { attachmentSignal: 'preview' }),
    ).toEqual({ comparedFields: ['sender', 'subject', 'preview'], bodySearched: false });
  });

  it('ignores a whitespace-only topic, which applies no filter', () => {
    expect(describeSearchCoverage({ topicContains: '  ' }, { attachmentSignal: 'preview' })).toEqual({
      comparedFields: [],
      bodySearched: false,
    });
  });

  it('counts preview text for the browser attachment heuristic but not for Graph metadata', () => {
    expect(describeSearchCoverage({ hasAttachment: true }, { attachmentSignal: 'preview' })).toEqual({
      comparedFields: ['preview'],
      bodySearched: false,
    });
    expect(describeSearchCoverage({ hasAttachment: true }, { attachmentSignal: 'metadata' })).toEqual({
      comparedFields: [],
      bodySearched: false,
    });
  });

  it('never claims a body search', () => {
    for (const args of [{}, { topicContains: 'x' }, { subjectContains: 'x' }, { from: 'x' }]) {
      expect(describeSearchCoverage(args, { attachmentSignal: 'preview' }).bodySearched).toBe(false);
    }
  });
});

describe('isSubjectFilterSupersededByTopic', () => {
  // Review finding MAJOR-1: supplying both text filters is a strict AND, which
  // excludes exactly the preview-only row the topic filter exists to find. The
  // frozen prompt asks to "list their exact subject lines", which invites a
  // model to add the subject filter to a topical search.
  it('supersedes the subject clause when both filters carry the same needle', () => {
    expect(
      isSubjectFilterSupersededByTopic({ subjectContains: 'academic year', topicContains: 'academic year' }),
    ).toBe(true);
    expect(
      isSubjectFilterSupersededByTopic({ subjectContains: 'Academic  Year', topicContains: 'academic year' }),
    ).toBe(true);
  });

  it('keeps a strict AND when the two needles genuinely differ', () => {
    expect(
      isSubjectFilterSupersededByTopic({ subjectContains: 'circular', topicContains: 'academic year' }),
    ).toBe(false);
  });

  it('does nothing when only one filter is supplied', () => {
    expect(isSubjectFilterSupersededByTopic({ subjectContains: 'academic year' })).toBe(false);
    expect(isSubjectFilterSupersededByTopic({ topicContains: 'academic year' })).toBe(false);
    expect(isSubjectFilterSupersededByTopic({})).toBe(false);
    expect(isSubjectFilterSupersededByTopic({ subjectContains: '  ', topicContains: 'academic year' })).toBe(false);
  });
});

describe('topicCoverageNote', () => {
  const browserNote = topicCoverageNote({ previewCharLimit: BROWSER_PREVIEW_CHAR_LIMIT });

  it('states the bounded coverage and refuses the exhaustive claim', () => {
    expect(browserNote).toContain('subject');
    expect(browserNote).toContain('preview');
    expect(browserNote).toContain('not an exhaustive topic search');
    expect(browserNote).toMatch(/not searched/);
  });

  // Review finding MODERATE-1: the preview is capped, and measured row text in
  // the acceptance window runs well past the cap, so "I searched the preview
  // text" is a slightly stronger claim than what happened.
  it('discloses the browser preview character cap as a real ceiling', () => {
    expect(browserNote).toContain(String(BROWSER_PREVIEW_CHAR_LIMIT));
    expect(browserNote).toMatch(/past that point/);
  });

  it('says the provider truncates the preview when the cap is not ours', () => {
    const graphNote = topicCoverageNote({ previewCharLimit: null });
    expect(graphNote).toMatch(/truncates/);
    expect(graphNote).not.toContain(String(BROWSER_PREVIEW_CHAR_LIMIT));
    expect(graphNote).toContain('not an exhaustive topic search');
  });
});

describe('BROWSER_PREVIEW_CHAR_LIMIT', () => {
  // Locked to the parser the browser lane actually runs, so the disclosed
  // number cannot drift away from the truncation it describes.
  it('equals the cap the real row parser applies', () => {
    const filler = 'supplier rotation notice ';
    const row = parseInboxRowTexts(
      ['DO', 'District Office', 'Term dates', 'Mon 7 Sep', filler.repeat(40)],
      '',
    );
    expect(row.snippet.length).toBe(BROWSER_PREVIEW_CHAR_LIMIT);
  });

  it('drops preview text past the cap, which the note has to admit', () => {
    const row = parseInboxRowTexts(
      ['DO', 'District Office', 'Term dates', 'Mon 7 Sep', `${'x'.repeat(300)} academic year`],
      '',
    );
    expect(matchesTopicText(row, 'academic year')).toBe(false);
  });
});

describe('validateSearchInboxTopicArg', () => {
  it('accepts an absent or string topic', () => {
    expect(validateSearchInboxTopicArg({})).toBeNull();
    expect(validateSearchInboxTopicArg({ topicContains: 'academic year' })).toBeNull();
    expect(validateSearchInboxTopicArg({ topicContains: '' })).toBeNull();
    expect(validateSearchInboxTopicArg({ topicContains: undefined })).toBeNull();
    expect(validateSearchInboxTopicArg({ topicContains: null })).toBeNull();
  });

  it('rejects a non-string topic', () => {
    expect(validateSearchInboxTopicArg({ topicContains: 5 })).toBe('topicContains must be a string');
    expect(validateSearchInboxTopicArg({ topicContains: ['a'] })).toBe('topicContains must be a string');
    expect(validateSearchInboxTopicArg({ topicContains: { a: 1 } })).toBe('topicContains must be a string');
  });

  it('leaves the pre-existing arguments alone so current requests keep working', () => {
    // top as a string is ignored by the service today; validation must not
    // start rejecting it and change search behaviour.
    expect(validateSearchInboxTopicArg({ top: '25', subjectContains: 7 })).toBeNull();
  });

  it('tolerates a missing body', () => {
    expect(validateSearchInboxTopicArg(null)).toBeNull();
    expect(validateSearchInboxTopicArg(undefined)).toBeNull();
  });
});
