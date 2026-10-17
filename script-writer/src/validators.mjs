import { countHanAndWords, excerpt, locate, readerFacingText, sha256 } from './utils.mjs';

function makeIssue(type, severity, text, index, constraint, suggestion) {
  return {
    issue_type: type,
    severity,
    location: locate(text, index),
    quote: excerpt(text, index),
    violated_constraint: constraint,
    suggested_range: suggestion
  };
}

function firstMarkerPosition(text, markers = []) {
  let found = -1;
  for (const marker of markers) {
    const position = text.indexOf(marker);
    if (position >= 0 && (found < 0 || position < found)) found = position;
  }
  return found;
}

export function extractActualEvents(draft, packet) {
  // Audit the continuous story itself. The title and identity opener are reader-facing
  // packaging, but they must not be allowed to satisfy a required story event.
  const text = draft.body;
  const events = [];
  for (const phase of packet.skeleton.phases) {
    for (const required of phase.requiredEvents) {
      const position = firstMarkerPosition(text, required.evidenceMarkers);
      if (position >= 0) {
        events.push({
          phaseId: phase.id,
          eventId: required.id,
          observedText: excerpt(text, position),
          location: locate(text, position),
          position
        });
      }
    }
  }
  const knowledgeChanges = [];
  for (const boundary of packet.routeContract.knowledgeBoundaries) {
    const revealPosition = firstMarkerPosition(text, boundary.allowedRevealMarkers || []);
    if (revealPosition >= 0) knowledgeChanges.push({ subject: boundary.subject, location: locate(text, revealPosition), position: revealPosition });
  }
  return { events: events.sort((a, b) => a.position - b.position), knowledgeChanges };
}

export function checkFactsAndStructure(draft, packet) {
  const text = readerFacingText(draft);
  const body = draft.body;
  const extracted = extractActualEvents(draft, packet);
  const issues = [];

  for (const phase of packet.skeleton.phases) {
    for (const required of phase.requiredEvents) {
      if (!extracted.events.some((event) => event.eventId === required.id)) {
        issues.push({
          issue_type: 'KEY_EVENT_OMISSION', severity: required.severity || 'blocker',
          location: { paragraph: null, line: null }, quote: '',
          violated_constraint: `Required event ${required.id}: ${required.description}`,
          suggested_range: `Return to skeleton phase ${phase.id}; revise only the nearest scene range.`
        });
      }
    }
  }

  for (const boundary of packet.routeContract.knowledgeBoundaries) {
    for (const claim of boundary.forbiddenClaims || []) {
      const regex = claim instanceof RegExp ? claim : new RegExp(claim, 'u');
      const match = regex.exec(text);
      if (!match) continue;
      const reveal = firstMarkerPosition(text, boundary.allowedRevealMarkers || []);
      if (reveal < 0 || match.index < reveal) {
        issues.push(makeIssue('KNOWLEDGE_BOUNDARY_VIOLATION', 'blocker', text, match.index,
          `${boundary.subject} must not know “${boundary.fact}” before ${boundary.unknownUntil}.`,
          'Rewrite the quoted sentence and any dependent reaction; preserve surrounding events.'));
      }
    }
  }

  for (const promise of packet.routeContract.promises) {
    const position = firstMarkerPosition(text, promise.payoffMarkers);
    if (position < 0) {
      issues.push({
        issue_type: 'PROMISE_UNPAID', severity: 'blocker', location: { paragraph: null, line: null }, quote: '',
        violated_constraint: `Promise must be paid off: ${promise.description}`,
        suggested_range: `Revise the climax or resolution where promise ${promise.id} should be fulfilled.`
      });
    }
  }

  const goalPosition = firstMarkerPosition(text, packet.routeContract.goalEvidenceMarkers || []);
  const endingPosition = firstMarkerPosition(body.slice(-600), packet.routeContract.endingEvidenceMarkers || []);
  if (goalPosition < 0 || endingPosition < 0) {
    issues.push({
      issue_type: 'CORE_GOAL_OR_ENDING_DRIFT', severity: 'blocker', location: { paragraph: null, line: null }, quote: '',
      violated_constraint: `Central goal and ending must remain: ${packet.routeContract.centralGoal} / ${packet.routeContract.ending}`,
      suggested_range: goalPosition < 0 ? 'Return to the relevant skeleton goal node.' : 'Revise only the resolution range to restore the approved ending.'
    });
  }

  for (const forbidden of packet.routeContract.forbiddenDecisiveAdditions || []) {
    const regex = forbidden instanceof RegExp ? forbidden : new RegExp(forbidden, 'u');
    const match = regex.exec(text);
    if (match) issues.push(makeIssue('UNAPPROVED_DECISIVE_ADDITION', 'blocker', text, match.index,
      'No decisive person, resource, ability or evidence may be silently added outside the approved contract.',
      'Remove the decisive addition and return to the corresponding skeleton node if causality no longer closes.'));
  }

  for (const boundary of packet.routeContract.capabilityBoundaries) {
    for (const forbidden of boundary.forbiddenSolutions || []) {
      const regex = forbidden instanceof RegExp ? forbidden : new RegExp(forbidden, 'u');
      const match = regex.exec(text);
      if (match) issues.push(makeIssue('UNAPPROVED_EXTERNAL_RESCUE', 'blocker', text, match.index,
        `Climax must be resolved by ${packet.routeContract.climaxResolution}; forbidden solution: ${boundary.description}.`,
        'Replace only the rescue mechanism in the climax; keep the outcome and verified setup.'));
    }
  }

  const climaxPosition = firstMarkerPosition(text, packet.routeContract.climaxEvidenceMarkers || []);
  if (climaxPosition < 0) {
    issues.push({
      issue_type: 'CLIMAX_RESOLUTION_DRIFT', severity: 'blocker', location: { paragraph: null, line: null }, quote: '',
      violated_constraint: `Climax resolution must remain: ${packet.routeContract.climaxResolution}`,
      suggested_range: 'Return to the climax skeleton node; do not invent a new rescuer or resource.'
    });
  }

  const ending = body.slice(-500);
  for (const pattern of packet.routeContract.forbiddenEndingPatterns || []) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'u');
    const match = regex.exec(ending);
    if (match) {
      const index = text.length - ending.length + match.index;
      issues.push(makeIssue('UNRELATED_CLIFFHANGER', 'blocker', text, index,
        'The approved ending is complete and must not gain an unrelated suspense hook.',
        'Remove the appended hook only; preserve the existing emotional closure.'));
    }
  }

  const backendTerms = /\b(Beat|Gate|Schema|Reader Reward)\b|这一幕的功能是|审核结论|规划说明/iu;
  const formatMatch = backendTerms.exec(text);
  if (formatMatch) issues.push(makeIssue('BACKEND_TERM_IN_READER_TEXT', 'blocker', text, formatMatch.index,
    'Reader-facing output may contain only title, identity opening and continuous body.',
    'Remove the planning or audit language from reader-facing text; keep it in internal metadata.'));

  return { issues, extracted };
}

export function checkExpression(draft, packet) {
  const text = readerFacingText(draft);
  const issues = [];
  const vaguePatterns = [/总而言之/g, /这一切都让[他她你]明白/g, /生活就是这样/g];
  for (const pattern of vaguePatterns) {
    for (const match of text.matchAll(pattern)) {
      issues.push(makeIssue('EMPTY_SUMMARY', 'warning', text, match.index,
        'Meaning should be carried by concrete action or perception, not a generic summary.',
        'Revise the current sentence or adjacent two sentences only.'));
    }
  }

  const transitionMatches = [...text.matchAll(/(?:于是|然后|接着|随后|后来)[，,]/g)];
  if (transitionMatches.length > Math.max(8, text.length / 450)) {
    const match = transitionMatches[8];
    issues.push(makeIssue('OVERUSED_TRANSITION', 'warning', text, match.index,
      'Transitions repeat often enough to flatten paragraph rhythm.',
      'Revise transition wording across the affected local paragraphs; do not change events.'));
  }

  if (packet.skeleton.kind === 'long-term-growth') {
    const growthEvidence = (text.match(/练习|记录|复盘|试验|失败|重来|校准|修改/g) || []).length;
    if (growthEvidence < 4) {
      issues.push({
        issue_type: 'NECESSARY_GROWTH_OMITTED', severity: 'major', location: { paragraph: null, line: null }, quote: '',
        violated_constraint: 'Time compression must retain the necessary growth process rather than jump directly to mastery.',
        suggested_range: 'Expand the middle growth range with two or three causal learning moments; do not add filler incidents.'
      });
    }
  }

  return { issues };
}

function trigrams(value) {
  const compact = value.replace(/[\s\p{P}]/gu, '');
  const set = new Set();
  for (let i = 0; i < compact.length - 2; i += 1) set.add(compact.slice(i, i + 3));
  return set;
}

function jaccard(a, b) {
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function checkBatchExpression(items) {
  const issues = [];
  const comparisons = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      const openingA = a.draft.body.split(/\n\s*\n/)[0] || '';
      const openingB = b.draft.body.split(/\n\s*\n/)[0] || '';
      const endingA = a.draft.body.slice(-220);
      const endingB = b.draft.body.slice(-220);
      const openingSimilarity = jaccard(trigrams(openingA), trigrams(openingB));
      const endingSimilarity = jaccard(trigrams(endingA), trigrams(endingB));
      const lengthsA = a.draft.body.split(/\n\s*\n/).map((p) => Math.round(p.length / 80));
      const lengthsB = b.draft.body.split(/\n\s*\n/).map((p) => Math.round(p.length / 80));
      const structureSame = lengthsA.length === lengthsB.length && lengthsA.every((value, index) => value === lengthsB[index]);
      comparisons.push({ pair: [a.id, b.id], openingSimilarity, endingSimilarity, structureSame });
      if (openingSimilarity > 0.7 || endingSimilarity > 0.7 || structureSame) {
        issues.push({
          issue_type: 'BATCH_EXPRESSION_REPETITION', severity: 'warning', pair: [a.id, b.id],
          location: { paragraph: 1, line: null }, quote: '',
          violated_constraint: 'Different skeletons must not use mechanically identical openings, progressions, climaxes or endings.',
          suggested_range: openingSimilarity > endingSimilarity ? 'Revise the opening entry only.' : 'Revise the ending expression only.'
        });
      }
    }
  }
  return { issues, comparisons };
}

export function validateDraft(draft, packet) {
  const structural = checkFactsAndStructure(draft, packet);
  const expression = checkExpression(draft, packet);
  const readerText = readerFacingText(draft);
  const allIssues = [...structural.issues, ...expression.issues];
  const repairRouting = structural.issues.some((issue) => ['CORE_GOAL_OR_ENDING_DRIFT', 'UNAPPROVED_DECISIVE_ADDITION'].includes(issue.issue_type))
    ? 'ROUTE_OR_SKELETON'
    : structural.issues.some((issue) => issue.severity === 'blocker')
      ? 'SKELETON_NODE'
      : expression.issues.length
        ? 'LOCAL_TEXT_RANGE'
        : 'NONE';
  return {
    reportVersion: '0.1',
    draftHash: sha256(readerText),
    targetCharacters: packet.targetLength,
    actualCharacters: countHanAndWords(readerText),
    estimatedDuration: null,
    structuralIssues: structural.issues,
    expressionIssues: expression.issues,
    repairRouting,
    extracted: structural.extracted,
    passed: !allIssues.some((issue) => issue.severity === 'blocker')
  };
}
