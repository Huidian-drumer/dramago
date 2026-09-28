const VOICE_KEYS = [
  'person',
  'audienceInformationPosition',
  'tone',
  'narrativeDistance',
  'dialogueStrategy',
  'timeCompressionStrategy',
  'endingEffect'
];

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required string: ${field}`);
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`Missing required array: ${field}`);
}

export function validateRouteContract(contract) {
  requireString(contract?.routeId, 'routeContract.routeId');
  requireString(contract?.protagonist?.name, 'routeContract.protagonist.name');
  requireString(contract?.centralGoal, 'routeContract.centralGoal');
  requireString(contract?.ending, 'routeContract.ending');
  requireString(contract?.climaxResolution, 'routeContract.climaxResolution');
  requireArray(contract?.knowledgeBoundaries, 'routeContract.knowledgeBoundaries');
  requireArray(contract?.capabilityBoundaries, 'routeContract.capabilityBoundaries');
  requireArray(contract?.promises, 'routeContract.promises');
}

export function validateSkeleton(skeleton) {
  requireString(skeleton?.skeletonId, 'skeleton.skeletonId');
  if (skeleton?.status !== 'approved') throw new Error('Skeleton must be explicitly approved.');
  requireArray(skeleton?.phases, 'skeleton.phases');
  if (skeleton.phases.length < 3) throw new Error('Skeleton requires at least three narrative phases.');
  for (const [index, phase] of skeleton.phases.entries()) {
    requireString(phase.id, `skeleton.phases[${index}].id`);
    requireString(phase.purpose, `skeleton.phases[${index}].purpose`);
    requireArray(phase.requiredEvents, `skeleton.phases[${index}].requiredEvents`);
  }
}

export function validateVoiceBrief(voiceBrief) {
  for (const key of VOICE_KEYS) requireString(voiceBrief?.[key], `voiceBrief.${key}`);
}

export function createWritingPacket(input) {
  validateRouteContract(input.routeContract);
  validateSkeleton(input.skeleton);
  validateVoiceBrief(input.voiceBrief);
  requireArray(input.characters, 'characters');
  requireArray(input.initialFacts, 'initialFacts');
  requireArray(input.knowledgeBoundaries, 'knowledgeBoundaries');
  requireArray(input.emotionalAnchors, 'emotionalAnchors');
  if (!Number.isInteger(input.targetLength) || input.targetLength < 500) throw new Error('targetLength must be an integer of at least 500.');

  const historyProblems = Array.isArray(input.recentRepetitionProblems)
    ? input.recentRepetitionProblems.slice(-5)
    : [];

  return {
    packetVersion: '0.1',
    routeContract: structuredClone(input.routeContract),
    skeleton: structuredClone(input.skeleton),
    characters: structuredClone(input.characters),
    initialFacts: structuredClone(input.initialFacts),
    knowledgeBoundaries: structuredClone(input.knowledgeBoundaries),
    promisesAndAnchors: structuredClone(input.emotionalAnchors),
    voiceBrief: structuredClone(input.voiceBrief),
    recentRepetitionProblems: historyProblems,
    targetLength: input.targetLength,
    authorRequirements: String(input.authorRequirements || '').trim()
  };
}

export function allocateNarrativeFocus(packet) {
  const phases = packet.skeleton.phases;
  const weights = phases.map((phase) => Number(phase.weight || 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  return phases.map((phase, index) => {
    const isLast = index === phases.length - 1;
    const characters = isLast
      ? packet.targetLength - allocated
      : Math.round(packet.targetLength * weights[index] / total);
    allocated += characters;
    return { phaseId: phase.id, purpose: phase.purpose, targetCharacters: characters };
  });
}
