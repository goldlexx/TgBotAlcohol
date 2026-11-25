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
  january: ['Здоровье', 'de Visser и Piper · Самочувствие участников «Сухого января»', 'https://pubmed.ncbi.nlm.nih.gov/32391879/'],
  energySurvey: ['Здоровье', 'de Visser · Энергия и сон в опросе «Сухого января»', 'https://movendi.ngo/wp-content/uploads/2026/01/R.-de-Visser-Dry-January-evaluation-2018.pdf'],
  parr: ['Здоровье', 'Parr et al. · Синтез мышечного белка после тренировки', 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0088384'],
  karunakaran: ['Здоровье', 'Karunakaran и Michael · Эректильная функция', 'https://pubmed.ncbi.nlm.nih.gov/35236641/'],
  density: ['Расчёты', 'PubChem · Этанол', 'https://pubchem.ncbi.nlm.nih.gov/compound/Ethanol'],
  energy: ['Расчёты', 'EU 1169/2011 · Энергия этанола', 'https://www.legislation.gov.uk/eur/2011/1169/annex/XIV/2023-04-23/data.htm']
};

const populations = {
  mehta: ['Взрослые с умеренным и высоким употреблением без зависимости', 'Наблюдательное исследование, около месяца, групповые значения'],
  powell: ['Взрослые с расстройством, связанным с употреблением алкоголя', 'Обзор продольных исследований. Сроки, тесты и результаты различались'],
  iarc: ['Люди, ранее употреблявшие алкоголь', 'Долгосрочные популяционные данные. Индивидуальная величина риска неизвестна'],
  nhs: ['Люди с возможной алкогольной зависимостью', 'Справка о симптомах, без прогноза или оценки конкретного человека'],
  facial: ['Взрослые женщины в четырёх странах', 'Поперечный опрос по самооценке, не проверял эффект отказа'],
  january: ['Взрослые участники британского «Сухого января» и группа сравнения', 'Наблюдательная когорта, группы отличались изначально, самооценка'],
  energySurvey: ['Участники британского «Сухого января» 2018 года', 'Опрос добровольцев, без рандомизации и объективного измерения сна или энергии'],
  parr: ['Восемь физически активных мужчин', 'Малое перекрёстное исследование высокой дозы после одной тренировки, не измеряло долгосрочный результат'],
  karunakaran: ['Мужчины с алкогольным расстройством и эректильной дисфункцией', 'Наблюдение в клинике, без контрольной группы, около трёх месяцев']
};

export const facts = [
  ['sleep', 'nhs', null, 'Сон', 'При отмене алкоголя возможны трудности со сном. Если появились симптомы отмены, нужна медицинская оценка.'],
  ['sleep-quality', 'energySurvey', null, 'Качество сна', 'Участники «Сухого января» в опросе в среднем выше оценивали свой сон к концу месяца.'],
  ['energy', 'energySurvey', null, 'Энергия', 'В опросе «Сухого января» часть участников сообщала, что чувствовала больше энергии.'],
  ['pressure', 'mehta', 30, 'Давление', 'У взрослых без зависимости, выбравших месячный перерыв, давление снизилось в среднем по группе.'],
  ['liver', 'mehta', 30, 'Печень', 'После месяца перерыва у группы взрослых без зависимости снизились показатели некоторых печёночных ферментов.'],
  ['metabolism', 'mehta', 30, 'Обмен веществ', 'У взрослых без зависимости после месяца перерыва организм в среднем лучше реагировал на инсулин.'],
  ['weight', 'mehta', 30, 'Вес', 'Вес немного снизился в среднем у группы взрослых без зависимости, выбравших месячный перерыв.'],
  ['wellbeing', 'january', null, 'Настроение', 'В британской наблюдательной работе участники «Сухого января» в среднем лучше оценивали своё психологическое самочувствие после месяца.'],
  ['activity', 'parr', null, 'Физическая активность', 'В небольшом эксперименте высокая доза алкоголя после тренировки замедляла синтез мышечного белка.'],
  ['sexual', 'karunakaran', null, 'Сексуальное здоровье', 'У части мужчин с алкогольным расстройством и эректильной дисфункцией в клиническом наблюдении после перерыва улучшилась эректильная функция.'],
  ['appearance', 'facial', null, 'Внешность', 'В одном опросе женщин высокое употребление алкоголя было связано с более выраженной отёчностью под глазами.'],
  ['memory', 'powell', null, 'Память', 'В исследованиях взрослых с алкогольной зависимостью показатели некоторых видов памяти улучшались в течение месяцев.'],
  ['attention', 'powell', null, 'Внимание', 'В исследованиях взрослых с алкогольной зависимостью некоторые показатели внимания улучшались в течение месяцев.'],
  ['mouth', 'iarc', null, 'Полость рта', 'По оценке IARC, отказ от алкоголя или уменьшение употребления снижает долгосрочный риск рака полости рта.'],
  ['esophagus', 'iarc', null, 'Пищевод', 'По оценке IARC, отказ от алкоголя или уменьшение употребления снижает долгосрочный риск рака пищевода.']
].map(([id, source_id, days, category, text]) => ({
  id, source_id, days, category, text, population: populations[source_id][0],
  limitations: populations[source_id][1], text_version: 2, checked_at: '2026-11-24', clinical_status: 'pending'
}));

export const recoveryMilestones = facts.filter(fact => fact.days !== null).sort((a, b) => a.days - b.days);
export const healthRotation = [
  'sleep', 'pressure', 'activity', 'sexual', 'liver', 'energy', 'memory', 'metabolism', 'appearance',
  'sleep-quality', 'wellbeing', 'mouth', 'attention', 'weight', 'esophagus'
].map(id => facts.find(fact => fact.id === id));
