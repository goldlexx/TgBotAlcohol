import { facts, sources } from '../content/facts.js';

for (const [section, title] of Object.entries({ recovery: 'Восстановление', health: 'Здоровье', risk: 'Медицинские риски' })) {
  console.log('\n' + title);
  for (const fact of facts.filter(item => item.section === section)) {
    const [, source, url] = sources[fact.source_id];
    console.log(`\n[${fact.clinical_status}${fact.previewOnly ? ', предварительный просмотр' : ''}] ${fact.category}\n${fact.text}\n${source} — ${url}\n${fact.limitations}`);
  }
}
