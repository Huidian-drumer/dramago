import { allocateNarrativeFocus } from './contracts.mjs';
import { parseDraftMarkdown, readerFacingText, sha256 } from './utils.mjs';
import { validateDraft } from './validators.mjs';

export const STRUCTURE_CHANGE_REQUIRED = 'STRUCTURE_CHANGE_REQUIRED';

function buildSystemPrompt(packet) {
  return [
    'You are DramaWorld Script Writer V0.1. Return only a title, an identity opening, and continuous prose.',
    'Preserve the protagonist goal, important facts, event outcomes, knowledge and capability boundaries, climax mechanism, and approved ending.',
    'You may create dialogue wording, observations, local actions, paragraph organization, rhythm, and non-decisive everyday detail.',
    `If the approved structure cannot support a coherent draft, return ${STRUCTURE_CHANGE_REQUIRED} followed by the exact structural gap.`,
    'Do not add planning vocabulary or audit conclusions to the reader-facing script.'
  ].join('\n');
}

function buildUserPrompt(packet, focusPlan) {
  return JSON.stringify({
    writingPacket: packet,
    narrativeFocusPlan: focusPlan,
    outputFormat: { title: 'string', identityOpening: 'string', body: 'continuous prose' }
  }, null, 2);
}

export class ScriptWriter {
  constructor({ provider, taskStore = null, maxAutoRepairs = 2 }) {
    this.provider = provider;
    this.taskStore = taskStore;
    this.maxAutoRepairs = maxAutoRepairs;
  }

  async generate(packet, { taskId }) {
    const focusPlan = allocateNarrativeFocus(packet);
    const startedAt = new Date().toISOString();
    const response = await this.provider.generateText({ system: buildSystemPrompt(packet), user: buildUserPrompt(packet, focusPlan) });
    if (response.text.trim().startsWith(STRUCTURE_CHANGE_REQUIRED)) {
      return { status: STRUCTURE_CHANGE_REQUIRED, gap: response.text.trim(), provider: response };
    }
    let draft = parseDraftMarkdown(response.text);
    let validation = validateDraft(draft, packet);
    let repairAttempts = 0;
    while (
      validation.repairRouting === 'LOCAL_TEXT_RANGE' &&
      repairAttempts < this.maxAutoRepairs &&
      typeof this.provider.repairText === 'function'
    ) {
      const repair = await this.provider.repairText({
        system: 'Repair only the cited local ranges. Preserve every approved fact, event, knowledge boundary, climax mechanism and ending. Return the complete script in the original reader-facing format.',
        user: JSON.stringify({ currentDraft: draft, issues: validation.expressionIssues }, null, 2)
      });
      draft = parseDraftMarkdown(repair.text);
      validation = validateDraft(draft, packet);
      repairAttempts += 1;
    }
    const result = {
      taskId,
      status: validation.passed ? 'VALIDATED' : 'NEEDS_REVIEW',
      version: 1,
      draft,
      focusPlan,
      validation,
      repairAttempts,
      modelCall: {
        provider: response.provider,
        model: response.model,
        authenticProviderCall: response.authenticProviderCall,
        generationMode: response.generationMode || 'PROVIDER_CALL',
        usage: response.usage,
        cost: null,
        startedAt,
        completedAt: new Date().toISOString()
      }
    };
    if (this.taskStore) await this.taskStore.save(result);
    return result;
  }

  validateExistingDraft(packet, draft, version = 1) {
    const validation = validateDraft(draft, packet);
    return {
      status: validation.passed ? 'VALIDATED' : 'NEEDS_REVIEW',
      version,
      draftHash: sha256(readerFacingText(draft)),
      validation
    };
  }
}
