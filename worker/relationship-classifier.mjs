// A conservative presentation index over an adopted, hash-bound Story Memory snapshot.
// It does not write memory or turn model labels into confirmed relationship facts.
const TYPE_LABELS = {
  family: '家庭关系', friends: '朋友／社交关系', work: '工作关系', interest_debt: '债务／利益关联'
};
const MARKERS = {
  family: /父亲|母亲|爸爸|妈妈|哥哥|弟弟|姐姐|妹妹|兄弟|姐妹|妻子|丈夫|儿子|女儿|外公|爷爷|奶奶|亲属|家人/u,
  friends: /朋友|好友|旧友|发小|同学|室友/u,
  work: /同事|上司|下属|老板|雇主|员工|工作搭档|工作伙伴|合伙人|直属领导|客户|负责人(?=.{0,15}(?:申请工作|应聘|求职|面试))/u,
  interest_debt: /借款|借钱|借了|欠款|欠钱|还款|偿还|债权|债务|债主|利益伙伴|利益关联/u
};
const GROUPS = ['family', 'friends', 'work', 'interest_debt', 'unconfirmed'];

function sentences(content) {
  const result = [];
  // A location or role mentioned in another clause must not be assigned to
  // every character in the same sentence.
  const re = /[^。！？，；\n]+[。！？，；]?/gu;
  for (const match of String(content || '').matchAll(re)) {
    const quote = match[0].trim();
    if (!quote) continue;
    const start = match.index + match[0].indexOf(quote);
    const before = String(content || '').slice(0, start);
    const inDialogue = (before.match(/“/gu) || []).length > (before.match(/”/gu) || []).length
      || ((before.match(/"/gu) || []).length % 2) !== 0
      || /[“”"]|(?:说|问|喊|告诉|答道|回复)[^。！？\n]{0,20}(?:：|:)/u.test(quote);
    result.push({ quote, start, end: start + quote.length, inDialogue });
  }
  return result;
}

function aliases(item) {
  return [...new Set([item?.name, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
    .map((name) => String(name || '').trim()).filter((name) => name.length >= 2))];
}

function explicitlyLinked(sentence, protagonistNames, personNames, secondPersonNarration = false) {
  const hasPerson = personNames.some((name) => sentence.quote.includes(name));
  if (!hasPerson || sentence.inDialogue) return false;
  if (protagonistNames.some((name) => sentence.quote.includes(name))) return true;
  return secondPersonNarration && /你(?:的)?(?:父亲|母亲|爸爸|妈妈|哥哥|弟弟|姐姐|妹妹|妻子|丈夫|儿子|女儿|朋友|同事)/u.test(sentence.quote)
    && !/(?:说|声称|自称|谎称|以为|误认|宣称|否认)/u.test(sentence.quote);
}

function isClaimOrNegation(sentence, marker) {
  const index = sentence.search(marker);
  if (index < 0) return false;
  const prefix = sentence.slice(Math.max(0, index - 18), index);
  return /说|声称|自称|谎称|坚称|宣称|以为|误认/u.test(prefix)
    || /不是|并非|不算|从未|没有|未曾/u.test(prefix.slice(-9))
    || /[“"].*(说|称|是)/u.test(sentence.slice(0, index));
}

function explicitTypes(sentence) {
  return Object.entries(MARKERS).filter(([, marker]) => marker.test(sentence)
    && !isClaimOrNegation(sentence, marker)).map(([type]) => type);
}

function markerBelongsToPerson(sentence, type, personNames, otherNames) {
  const markerIndex = sentence.search(MARKERS[type]);
  const personIndex = personNames.map((name) => sentence.indexOf(name)).find((index) => index >= 0);
  if (markerIndex < 0 || personIndex == null) return false;
  return !otherNames.some((name) => {
    const otherIndex = sentence.indexOf(name);
    return otherIndex >= 0 && Math.min(markerIndex, personIndex) < otherIndex
      && otherIndex < Math.max(markerIndex, personIndex);
  });
}

function eventIds(memory, sentence) {
  return (memory.events || []).filter((event) => (event.evidence || []).some((entry) =>
    entry.quote && sentence.quote.includes(entry.quote))).map((event) => event.id);
}

function primaryFromExplicitCue(sentence, types) {
  if (types.length === 1) return types[0];
  if (!/主要|首先|最重要/u.test(sentence)) return null;
  const cue = sentence.search(/主要|首先|最重要/u);
  const after = sentence.slice(cue);
  const ranked = types.map((type) => ({ type, index: after.search(MARKERS[type]) }))
    .filter((item) => item.index >= 0).sort((a, b) => a.index - b.index);
  return ranked[0]?.type || null;
}

export function buildRelationshipTree(memory = {}, sourceContent = '') {
  const groups = Object.fromEntries(GROUPS.map((key) => [key, []]));
  const characters = Array.isArray(memory.characters) ? memory.characters : [];
  const protagonist = characters.find((item) => /主角|主人公|叙述者/u.test(`${item.identity || ''}${item.state || ''}`)) || null;
  const versionId = memory.provenance?.version_id || null;
  const contentHash = memory.provenance?.content_hash || null;
  if (!protagonist || !versionId || !contentHash) return { protagonist: null, groups,
    source_version_id: versionId, source_content_hash: contentHash, derived_only_from_memory: true };

  const allSentences = sentences(sourceContent);
  const protagonistNames = aliases(protagonist);
  const secondPersonNarration = allSentences.some((sentence) => !sentence.inDialogue
    && /你(?:的)?(?:父亲|母亲|爸爸|妈妈|哥哥|弟弟|姐姐|妹妹|妻子|丈夫|儿子|女儿)/u.test(sentence.quote)
    && !/(?:说|声称|自称|谎称|以为|误认|宣称|否认)/u.test(sentence.quote));
  for (const item of characters.filter((entry) => entry !== protagonist)) {
    const personNames = aliases(item).filter((name) => !protagonistNames.includes(name));
    const ambiguousAlias = personNames.some((name) => characters.filter((entry) => aliases(entry).includes(name)).length > 1);
    const otherNames = characters.filter((entry) => entry !== protagonist && entry !== item)
      .flatMap(aliases);
    const direct = allSentences.filter((sentence, index) => {
      if (explicitlyLinked(sentence, protagonistNames, personNames, secondPersonNarration)) return true;
      // A following clause may add a second relationship only when the
      // protagonist is named again and no competing person is introduced.
      const prior = allSentences[index - 1];
      return Boolean(prior && explicitlyLinked(prior, protagonistNames, personNames, secondPersonNarration)
        && protagonistNames.some((name) => sentence.quote.includes(name))
        && !otherNames.some((name) => sentence.quote.includes(name))
        && /^(?:也是|同时也是|并且是)/u.test(sentence.quote));
    });
    const edges = [];
    for (const sentence of direct) {
      const inheritedPair = !personNames.some((name) => sentence.quote.includes(name));
      const types = explicitTypes(sentence.quote).filter((type) => inheritedPair || markerBelongsToPerson(
        sentence.quote, type, personNames, otherNames));
      const uncertain = item.truth_status !== 'objective' || item.certainty !== 'confirmed'
        || item.author_review === 'flagged_incorrect' || ambiguousAlias || sentence.inDialogue
        || /说|声称|自称|谎称|坚称|宣称|以为|误认|曾经|曾是|以前|过去|原本|已经不是|不再|前妻|前夫/u.test(sentence.quote);
      for (const type of types) {
        if (edges.some((edge) => edge.relationship_type === type && edge.certainty === 'confirmed')) continue;
        edges.push({ subject_id: protagonist.id, subject_name: protagonist.name,
          object_id: item.id, object_name: item.name, relationship_type: type,
          label: TYPE_LABELS[type], priority: 'unresolved', source_version_id: versionId,
          evidence: { ...sentence, version_id: versionId },
          certainty: uncertain ? 'pending' : 'confirmed',
          truth_status: uncertain ? item.truth_status || 'interpretation' : 'objective',
          event_ids: eventIds(memory, sentence) });
      }
    }
    const confirmed = [...new Set(edges.filter((edge) => edge.certainty === 'confirmed')
      .map((edge) => edge.relationship_type))];
    const cueSentence = direct.find((sentence) => /主要|首先|最重要/u.test(sentence.quote));
    const primary = confirmed.length === 1 ? confirmed[0]
      : cueSentence ? primaryFromExplicitCue(cueSentence.quote, confirmed) : null;
    for (const edge of edges) {
      edge.priority = primary && edge.certainty === 'confirmed'
        ? edge.relationship_type === primary ? 'primary' : 'secondary' : 'unresolved';
    }
    const key = primary || 'unconfirmed';
    const primaryEdge = edges.find((edge) => edge.relationship_type === primary && edge.certainty === 'confirmed');
    groups[key].push({ ...item, relationship_group: key,
      relationship_type: primary, primary_relationship: primaryEdge || null,
      secondary_relationships: edges.filter((edge) => edge.priority === 'secondary'),
      relationship_edges: edges, relationship_unconfirmed: !primary,
      evidence: primaryEdge ? [primaryEdge.evidence] : item.evidence || [] });
  }
  return { protagonist, groups, source_version_id: versionId,
    source_content_hash: contentHash, derived_only_from_memory: true };
}
