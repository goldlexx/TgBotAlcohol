export const sources = {
  nhs: ['Безопасность', 'NHS · Алкоголь и симптомы отмены', 'https://www.nhs.uk/conditions/alcohol-use-disorder/'],
  nice: ['Безопасность', 'NICE · Физические осложнения', 'https://www.nice.org.uk/guidance/cg100/chapter/recommendations'],
  overdose: ['Безопасность', 'NIAAA · Алкогольное отравление', 'https://www.niaaa.nih.gov/alcohols-effects-health/alcohol-topics/health-topics-alcohol-overdose'],
  craving: ['Поддержка', 'NIAAA · Как справляться с тягой', 'https://rethinkingdrinking.niaaa.nih.gov/tools/worksheets-more/how-stop-alcohol-cravings'],
  refusal: ['Поддержка', 'NIAAA · Как отказаться в компании', 'https://rethinkingdrinking.niaaa.nih.gov/tools/worksheets-more/building-your-drink-refusal-skills'],
  mehta: ['Здоровье', 'Mehta et al. · Давление, обмен веществ и вес', 'https://discovery.ucl.ac.uk/10048446/1/e020673.full.pdf'],
  powell: ['Здоровье', 'Powell et al. · Когнитивные функции', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10760842/'],
  iarc: ['Здоровье', 'IARC · Долгосрочные риски', 'https://www.iarc.who.int/faq/iarc-handbooks-of-cancer-prevention-volume-20a-reduction-or-cessation-of-alcohol-consumption/'],
  facial: ['Здоровье', 'Goodman et al. · Употребление алкоголя и внешность', 'https://jcadonline.com/aging-august-2019/'],
  density: ['Расчёты', 'PubChem · Этанол', 'https://pubchem.ncbi.nlm.nih.gov/compound/Ethanol'],
  energy: ['Расчёты', 'EU 1169/2011 · Энергия этанола', 'https://www.legislation.gov.uk/eur/2011/1169/annex/XIV/2023-04-23/data.htm']
};

const populations = {
  mehta: ['Взрослые с умеренным и высоким употреблением без зависимости', 'Наблюдательное исследование, около месяца, групповые значения'],
  powell: ['Взрослые с расстройством, связанным с употреблением алкоголя', 'Обзор продольных исследований. Сроки, тесты и результаты различались'],
  iarc: ['Люди, ранее употреблявшие алкоголь', 'Долгосрочные популяционные данные. Индивидуальная величина риска неизвестна'],
  nhs: ['Люди с возможной алкогольной зависимостью', 'Справка о симптомах, без прогноза или оценки конкретного человека'],
  facial: ['Взрослые женщины в четырёх странах', 'Поперечный опрос по самооценке, не проверял эффект отказа']
};

export const facts = [
  ['sleep', 'nhs', null, 'Сон', 'При отмене алкоголя возможны трудности со сном. Если появились симптомы отмены, нужна медицинская оценка.'],
  ['pressure', 'mehta', 30, 'Давление', 'Через месяц перерыва у группы взрослых без зависимости в одном исследовании снизилось давление.'],
  ['metabolism', 'mehta', 30, 'Обмен веществ', 'В одном исследовании у взрослых без зависимости после месяца перерыва снизилась инсулинорезистентность.'],
  ['weight', 'mehta', 30, 'Вес', 'В одном исследовании у взрослых без зависимости через месяц перерыва изменился вес в среднем по группе.'],
  ['liver', 'mehta', 30, 'Печень', 'В одном исследовании у взрослых без зависимости после месяца перерыва снизились показатели некоторых печёночных ферментов.'],
  ['appearance', 'facial', null, 'Внешность', 'В одном опросе женщин высокое употребление алкоголя было связано с более выраженной отёчностью под глазами.'],
  ['memory', 'powell', 180, 'Память', 'В исследованиях взрослых с алкогольной зависимостью показатели некоторых видов памяти улучшались в течение месяцев.'],
  ['attention', 'powell', 180, 'Внимание', 'В исследованиях взрослых с алкогольной зависимостью некоторые показатели внимания улучшались в течение месяцев.'],
  ['mouth', 'iarc', null, 'Полость рта', 'По оценке IARC, отказ от алкоголя или уменьшение употребления снижает долгосрочный риск рака полости рта.'],
  ['esophagus', 'iarc', null, 'Пищевод', 'По оценке IARC, отказ от алкоголя или уменьшение употребления снижает долгосрочный риск рака пищевода.']
].map(([id, source_id, days, category, text]) => ({
  id, source_id, days, category, text, population: populations[source_id][0],
  limitations: populations[source_id][1], text_version: 1, checked_at: '2026-11-24', clinical_status: 'pending'
}));
