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
  describeSearchCoverage,
  matchesTopicText,
  normalizeTopicText,
  TOPIC_COVERAGE_NOTE,
  validateSearchInboxTopicArg,
} from '@electron/services/outlook-browser/search-predicates';

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
      matchedFields: ['subject'],
      bodySearched: false,
    });
  });

  it('reports subject and preview for a topic filter', () => {
    expect(describeSearchCoverage({ topicContains: 'academic year' }, { attachmentSignal: 'preview' })).toEqual({
      matchedFields: ['subject', 'preview'],
      bodySearched: false,
    });
  });

  it('reports the sender when a from filter is supplied', () => {
    expect(
      describeSearchCoverage({ from: 'district', topicContains: 'academic year' }, { attachmentSignal: 'preview' }),
    ).toEqual({ matchedFields: ['sender', 'subject', 'preview'], bodySearched: false });
  });

  it('ignores a whitespace-only topic, which applies no filter', () => {
    expect(describeSearchCoverage({ topicContains: '  ' }, { attachmentSignal: 'preview' })).toEqual({
      matchedFields: [],
      bodySearched: false,
    });
  });

  it('counts preview text for the browser attachment heuristic but not for Graph metadata', () => {
    expect(describeSearchCoverage({ hasAttachment: true }, { attachmentSignal: 'preview' })).toEqual({
      matchedFields: ['preview'],
      bodySearched: false,
    });
    expect(describeSearchCoverage({ hasAttachment: true }, { attachmentSignal: 'metadata' })).toEqual({
      matchedFields: [],
      bodySearched: false,
    });
  });

  it('never claims a body search', () => {
    for (const args of [{}, { topicContains: 'x' }, { subjectContains: 'x' }, { from: 'x' }]) {
      expect(describeSearchCoverage(args, { attachmentSignal: 'preview' }).bodySearched).toBe(false);
    }
  });
});

describe('TOPIC_COVERAGE_NOTE', () => {
  it('states the bounded coverage and refuses the exhaustive claim', () => {
    expect(TOPIC_COVERAGE_NOTE).toContain('subject');
    expect(TOPIC_COVERAGE_NOTE).toContain('preview');
    expect(TOPIC_COVERAGE_NOTE).toContain('not an exhaustive topic search');
    expect(TOPIC_COVERAGE_NOTE).toMatch(/bodies .*not searched|not searched/);
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
