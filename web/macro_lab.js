const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  runButton: $('#run-button'), resumeButton: $('#resume-button'), status: $('#run-status'),
  runId: $('#run-id'), score: $('#score-value'), stage: $('#current-stage'),
  nowIcon: $('#now-icon'), nowLabel: $('#now-label'), nowMessage: $('#now-message'),
  eventButton: $('#event-detail-button'), eventDetail: $('#event-detail'), trace: $('#trace'),
  evidence: $('#metric-evidence'), quarantine: $('#metric-quarantine'),
  tools: $('#metric-tools'), effects: $('#metric-effects'), events: $('#metric-events'),
};

let manifest = null;
let activeRunId = null;
let currentEvent = null;
let eventCount = 0;
let toolCount = 0;
let running = false;
let latestEvidence = [];
let latestQuarantine = [];
let latestClaims = [];
let latestCpiAnalysis = null;
let lastReportTitle = 'Macro Research Report';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[ch]));

const pretty = (value) => JSON.stringify(value, null, 2);

async function init() {
  const response = await fetch('/api/macro/manifest');
  manifest = await response.json();
  renderAgents();
  renderPrinciples(manifest.principles.map(item => ({...item, passed: null})));
  restoreLocalKeys();
}

function renderAgents() {
  $('#agents').innerHTML = manifest.agents.map(agent => `
    <article class="agent-card" data-agent="${escapeHtml(agent.agent_id)}" tabindex="0">
      <div class="avatar">${agent.avatar}</div>
      <div><strong>${escapeHtml(agent.display_name)}</strong><small>${escapeHtml(agent.role)}</small></div>
      <i class="status-dot"></i>
    </article>`).join('');
  $$('.agent-card').forEach(card => {
    const open = () => openAgent(card.dataset.agent);
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => event.key === 'Enter' && open());
  });
}

function openAgent(agentId) {
  const agent = manifest.agents.find(item => item.agent_id === agentId);
  if (!agent) return;
  const list = values => `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
  $('#modal-content').innerHTML = `
    <div class="modal-agent"><div class="avatar">${agent.avatar}</div><div><h3>${escapeHtml(agent.display_name)}</h3><p>${escapeHtml(agent.role)} · ${escapeHtml(agent.mission)}</p></div></div>
    <div class="contract-columns">
      <div class="contract-box"><span>INPUT CONTRACT</span>${list(agent.inputs)}</div>
      <div class="contract-box"><span>OUTPUT CONTRACT</span>${list(agent.outputs)}</div>
      <div class="contract-box"><span>RUNTIME SCOPES</span>${list(agent.scopes.length ? agent.scopes : ['none'])}</div>
      <div class="contract-box"><span>MAY HANDOFF TO</span>${list(agent.may_handoff_to.length ? agent.may_handoff_to : ['terminal only'])}</div>
      <div class="contract-box" style="grid-column:1/-1"><span>FORBIDDEN</span>${list(agent.forbidden)}</div>
    </div>`;
  $('#agent-modal').classList.remove('hidden');
}

function renderPrinciples(checks) {
  $('#principles').innerHTML = checks.map(check => {
    const state = check.passed === true ? 'pass' : check.passed === false ? 'fail' : '';
    const icon = check.passed === true ? '✓' : check.passed === false ? '×' : '·';
    return `<article class="principle-card ${state}">
      <div class="principle-number">${String(check.number).padStart(2, '0')}</div>
      <div><strong>${escapeHtml(check.title)}</strong><small>${escapeHtml(check.mechanism)}</small></div>
      <div class="principle-state">${icon}</div>
      ${check.evidence ? `<div class="principle-detail">${escapeHtml(check.evidence)}</div>` : ''}
    </article>`;
  }).join('');
  const passed = checks.filter(item => item.passed === true).length;
  ui.score.textContent = `${passed}/9`;
}

function resetRunUi() {
  activeRunId = null;
  currentEvent = null;
  eventCount = 0;
  toolCount = 0;
  latestEvidence = [];
  latestQuarantine = [];
  latestClaims = [];
  latestCpiAnalysis = null;
  ui.trace.innerHTML = '<div class="empty-state">等待第一个持久化事件</div>';
  ui.eventDetail.classList.add('hidden');
  ui.eventButton.disabled = true;
  ui.evidence.textContent = '0';
  ui.quarantine.textContent = '0';
  ui.tools.textContent = '0';
  ui.effects.textContent = '0';
  ui.events.textContent = '0';
  ui.score.textContent = '0/9';
  ui.stage.textContent = 'STARTING';
  ui.resumeButton.classList.add('hidden');
  $('#contract-json').textContent = '—';
  $('#checkpoint-json').textContent = '—';
  $('#evidence-grid').innerHTML = '';
  $('#model-draft').innerHTML = '<div class="empty-result"><strong>等待 OpenAI 输出</strong><p>模型草稿将在 A1 阶段显示；它还不是最终发布报告。</p></div>';
  $('#tab-report').innerHTML = '<div class="empty-result"><strong>运行进行中</strong><p>数据计算、证据治理、OpenAI 提议与发布门禁正在依次执行。</p></div>';
  renderPrinciples(manifest.principles.map(item => ({...item, passed: null})));
  $$('.agent-card').forEach(item => item.classList.remove('active'));
  $$('.lane-route b').forEach(item => item.classList.remove('hot'));
}

function payload() {
  maybeRememberKeys();
  return {
    research_type: $('#research-type').value,
    question: $('#question').value,
    mode: $('#mode').value,
    scenario: $('#scenario').value,
    model_mode: $('#model-mode').value,
    fred_api_key: $('#fred-key').value,
    news_provider: $('#news-provider').value,
    news_api_key: $('#news-key').value,
    model_api_key: $('#model-key').value,
    model: $('#model-id').value,
    model_base_url: $('#model-url').value,
    model_timeout_seconds: Number($('#model-timeout').value),
  };
}

async function run() {
  if (running) return;
  resetRunUi();
  setRunning(true);
  try {
    await consumeStream('/api/macro/run/stream', payload());
  } catch (error) {
    setStatus('failure', '连接失败');
    ui.nowMessage.textContent = error.message;
  } finally {
    setRunning(false);
  }
}

async function resume() {
  if (running || !activeRunId) return;
  setRunning(true);
  ui.resumeButton.classList.add('hidden');
  try {
    const modelPayload = payload();
    await consumeStream('/api/macro/resume/stream', {...modelPayload, run_id: activeRunId}, true);
  } catch (error) {
    setStatus('failure', '恢复失败');
    ui.nowMessage.textContent = error.message;
  } finally {
    setRunning(false);
  }
}

async function consumeStream(url, body, isResume = false) {
  const response = await fetch(url, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
  });
  if (!response.ok) {
    let error;
    try { error = (await response.json()).error; } catch { error = `HTTP ${response.status}`; }
    throw new Error(error || `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const {done, value} = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) if (line.trim()) applyEvent(JSON.parse(line), isResume);
    if (done) break;
  }
  if (buffer.trim()) applyEvent(JSON.parse(buffer), isResume);
}

function applyEvent(event, isResume) {
  if (!activeRunId) activeRunId = event.run_id;
  if (event.run_id !== activeRunId) throw new Error('STREAM_ERROR: event belongs to another run');
  eventCount += 1;
  currentEvent = event;
  ui.runId.textContent = `RUN ${event.run_id}`;
  ui.events.textContent = eventCount;
  ui.stage.textContent = event.stage;
  ui.nowLabel.textContent = `${event.stage} · ${event.actor_name}`;
  ui.nowMessage.textContent = event.message;
  ui.nowIcon.textContent = manifest.agents.find(item => item.agent_id === event.actor)?.avatar || '◎';
  ui.eventButton.disabled = false;
  $('#event-detail pre').textContent = pretty(event);
  activateAgent(event.actor);
  activateLane(event);
  appendTrace(event);

  if (event.type === 'contract_compiled') $('#contract-json').textContent = pretty(event.data);
  if (event.type === 'tool_started') {
    toolCount += 1;
    ui.tools.textContent = toolCount;
  }
  if (event.type === 'evidence_gate_completed') {
    ui.evidence.textContent = event.data.accepted.length;
    ui.quarantine.textContent = event.data.quarantined.length;
    latestEvidence = event.data.accepted;
    latestQuarantine = event.data.quarantined;
    renderEvidence();
  }
  if (event.type === 'cpi_analysis_completed') latestCpiAnalysis = event.data.analysis;
  if (event.type === 'model_started') renderModelWaiting(event.data);
  if (event.type === 'model_proposal_created') renderModelDraft(event.data.proposal, null, event.data.model_mode);
  if (event.type === 'model_proposal_rejected') renderModelDraft(null, event.data.model_error, event.data.model_mode);
  if (event.type === 'principles_evaluated') renderPrinciples(event.data.checks);
  if (event.type === 'run_paused') {
    setStatus('warning', 'PAUSED · 可恢复');
    ui.resumeButton.classList.remove('hidden');
    loadCheckpoint();
  }
  if (event.type === 'run_completed') {
    const report = event.data.report;
    ui.effects.textContent = event.data.effect_count;
    renderReport(report, event.data.elapsed_ms);
    setStatus(report.status === 'COMPLETE' ? 'success' : 'warning', report.status);
    loadCheckpoint();
  }
  if (event.type === 'run_failed') {
    ui.effects.textContent = event.data.effect_count;
    setStatus('failure', 'FAILURE');
    loadCheckpoint();
  }
}

function activateAgent(agentId) {
  $$('.agent-card').forEach(card => card.classList.toggle('active', card.dataset.agent === agentId));
}

function activateLane(event) {
  $$('.lane-route b').forEach(item => item.classList.remove('hot'));
  const actorNode = document.querySelector(`[data-node="${event.actor}"]`);
  if (actorNode) actorNode.classList.add('hot');
  const riskKey = event.type.includes('contract') ? 'contract'
    : event.type.includes('capability') || event.type.includes('tool_') ? 'capability'
    : event.type.includes('evidence') ? 'taint'
    : event.type.includes('verification') || event.type.includes('principles') ? 'verify' : null;
  if (riskKey) document.querySelector(`[data-risk="${riskKey}"]`)?.classList.add('hot');
}

function appendTrace(event) {
  $('.empty-state')?.remove();
  const row = document.createElement('article');
  row.className = `trace-event ${event.flow}`;
  row.innerHTML = `<b>#${String(event.sequence).padStart(2, '0')}</b><span>${escapeHtml(event.type)}</span><span>${escapeHtml(event.actor_name)}</span><p>${escapeHtml(event.message)}</p>`;
  row.addEventListener('click', () => {
    currentEvent = event;
    $('#event-detail pre').textContent = pretty(event);
    ui.eventDetail.classList.remove('hidden');
  });
  ui.trace.appendChild(row);
  ui.trace.scrollTop = ui.trace.scrollHeight;
}

function renderEvidence() {
  const accepted = latestEvidence;
  const quarantined = latestQuarantine;
  const cards = [
    ...accepted.map(item => ({...item, rejected: false})),
    ...quarantined.map(item => ({...item, rejected: true})),
  ];
  const publishers = [...new Set(accepted.map(item => item.publisher))];
  const graph = `<div class="evidence-map">
    <div class="evidence-column"><span>SOURCES</span>${publishers.map(name => `<b>${escapeHtml(name)}</b>`).join('')}</div>
    <div class="graph-arrow">→</div>
    <div class="evidence-column"><span>ACCEPTED EVIDENCE</span>${accepted.map(item => `<b>${escapeHtml(item.evidence_id)}</b>`).join('')}</div>
    <div class="graph-arrow">→</div>
    <div class="evidence-column"><span>GROUNDED CLAIMS</span>${latestClaims.length ? latestClaims.map((claim, index) => `<b>C${index + 1} · ${(claim.evidence_ids || []).length} citations</b>`).join('') : '<b>Waiting for A1</b>'}</div>
  </div>`;
  $('#evidence-grid').innerHTML = graph + cards.map(item => `
    <article class="evidence-card ${item.rejected ? 'quarantined' : ''}">
      <span class="kind">${item.rejected ? 'QUARANTINED' : escapeHtml(item.evidence_id)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.content)}</p>
      <footer>${escapeHtml(item.publisher)} · ${escapeHtml(item.observed_at)}<br>${escapeHtml(item.uri)}</footer>
    </article>`).join('');
}

function renderReport(report, elapsedMs) {
  lastReportTitle = report.report_title || 'Macro Research Report';
  latestClaims = report.claims || [];
  renderEvidence();
  if (report.research_type === 'cpi_deep_dive' && report.cpi_analysis) {
    renderCpiReport(report, elapsedMs);
    return;
  }
  const claims = (report.claims || []).map(claim => `
    <article class="claim"><p>${escapeHtml(claim.text)}</p><div class="citations">${
      (claim.evidence_ids || []).map(id => `<span>${escapeHtml(id)}</span>`).join('')
    }</div></article>`).join('');
  $('#tab-report').innerHTML = `<article class="institutional-report" id="printable-report">
    <div class="report-masthead"><div><b>M9 MACRO RESEARCH</b><span>Independent analytical system · Research only</span></div><button class="pdf-button" data-export-pdf>⇩ Print / Save PDF</button></div>
    <div class="report-header"><div><h3>${escapeHtml(report.report_title || 'Macro Regime Research')}</h3><p>${escapeHtml(report.executive_summary)}</p></div><span class="outcome ${report.status === 'ABSTAIN' ? 'abstain' : ''}">${escapeHtml(report.status)}</span></div>
    ${report.model_error ? `<div class="publication-block"><strong>MODEL DRAFT UNAVAILABLE</strong><p>${escapeHtml(report.model_error)}</p><small>请在“OpenAI 原始草稿”标签查看诊断。数字分析仍保留，但未冒充模型报告发布。</small></div>` : ''}
    <div class="claim-list">${claims || '<article class="claim"><p>没有通过发布门禁的研究结论。</p></article>'}</div>
    <div class="report-meta"><span>Confidence ${Number(report.confidence || 0).toFixed(2)}</span><span>${report.research_only ? 'Research only' : ''}</span><span>Automatic execution ${String(report.automatic_execution)}</span><span>Effects ${report.effect_count}</span><span>${elapsedMs} ms</span></div></article>`;
}

function renderModelDraft(proposal, error, mode) {
  if (!proposal) {
    $('#model-draft').innerHTML = `<article class="model-diagnostic"><span>MODEL PROPOSAL REJECTED</span><h3>OpenAI 没有返回可验证的研究草稿</h3><p>${escapeHtml(error || 'Unknown model error')}</p><div><b>这不是报告结论</b><small>Runtime 已停止发布；Key、错误请求体和凭据不会写入 Trace。</small></div></article>`;
    return;
  }
  const claims = (proposal.claims || []).map(item => `<li><em>${escapeHtml(item.classification || 'UNCLASSIFIED')}</em><p>${escapeHtml(item.text)}</p><small>${(item.evidence_ids || []).map(escapeHtml).join(' · ')}</small></li>`).join('');
  $('#model-draft').innerHTML = `<article class="model-draft-view"><header><div><span>UNPUBLISHED MODEL DRAFT</span><h3>${escapeHtml(proposal.report_title || 'OpenAI Research Draft')}</h3></div><b>${escapeHtml(mode || 'live')}</b></header><section><h4>模型实际输出的摘要</h4><p>${escapeHtml(proposal.executive_summary)}</p></section><section><h4>模型实际输出的论点</h4><ol>${claims}</ol></section><details><summary>查看完整 Structured Output JSON</summary><pre>${escapeHtml(pretty(proposal))}</pre></details><footer>草稿必须经过 Citation、Evidence、Critic、SLO 与九项原则门禁，才会进入最终 PDF。</footer></article>`;
}

function renderModelWaiting(data) {
  $('#model-draft').innerHTML = `<article class="model-waiting"><div class="model-pulse" aria-hidden="true"></div><span>OPENAI RESPONSES API · GENERATING</span><h3>模型正在撰写可验证的中文研究草稿</h3><p>${escapeHtml(data.model)} · 最长等待 ${escapeHtml(data.timeout_seconds)} 秒</p><div><b>请求仍在处理中</b><small>页面会保持流式运行；不会自动重试，也不会把 API Key 写入 Trace。</small></div></article>`;
}

function metric(value, suffix = '') {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}${suffix}`;
}

function lineChart(points) {
  if (!points?.length) return '<div class="chart-empty">历史曲线不可用</div>';
  const width = 760, height = 230, pad = 30;
  const values = points.flatMap(point => [point.headline, point.core]).filter(Number.isFinite);
  const min = Math.min(...values) - .25, max = Math.max(...values) + .25;
  const x = index => pad + index * (width - pad * 2) / Math.max(1, points.length - 1);
  const y = value => height - pad - (value - min) * (height - pad * 2) / Math.max(.1, max - min);
  const path = key => points.map((point, index) => Number.isFinite(point[key])
    ? `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}` : '').join(' ');
  const grid = [0, .25, .5, .75, 1].map(ratio => {
    const value = max - ratio * (max - min), ypos = pad + ratio * (height - pad * 2);
    return `<line x1="${pad}" y1="${ypos}" x2="${width-pad}" y2="${ypos}"/><text x="2" y="${ypos+3}">${value.toFixed(1)}</text>`;
  }).join('');
  return `<svg class="cpi-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Headline and core CPI year over year history">
    <g class="chart-grid">${grid}</g><path class="headline-line" d="${path('headline')}"/><path class="core-line" d="${path('core')}"/>
    <g class="chart-legend"><circle cx="${pad}" cy="12" r="4"/><text x="${pad+9}" y="16">Headline YoY</text><circle class="core-dot" cx="${pad+112}" cy="12" r="4"/><text x="${pad+121}" y="16">Core YoY</text></g>
    <text class="chart-date" x="${pad}" y="${height-4}">${escapeHtml(points[0].date)}</text><text class="chart-date" text-anchor="end" x="${width-pad}" y="${height-4}">${escapeHtml(points.at(-1).date)}</text>
  </svg>`;
}

function renderCpiReport(report, elapsedMs) {
  lastReportTitle = report.report_title || '美国 CPI 影响因子专题';
  const analysis = report.cpi_analysis;
  const headline = analysis.headline || {};
  const core = analysis.core || {};
  const factorRows = (analysis.factors || []).map(item => {
    const strength = Math.min(100, Math.abs(Number(item.acceleration || 0)) * 15 + Math.abs(Number(item.lag_correlation || 0)) * 45);
    return `<tr><td><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.symbol)} · ${escapeHtml(item.kind)}</small></td><td>${metric(item.yoy, '%')}</td><td>${metric(item.momentum_3m_annualized, '%')}</td><td><span class="signal ${String(item.signal).toLowerCase()}">${escapeHtml(item.signal)}</span></td><td>${metric(item.lag_correlation)} / ${item.best_lag_months}m</td><td><div class="pressure"><i style="width:${strength}%"></i></div></td></tr>`;
  }).join('');
  const findings = (report.key_findings || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const claims = (report.claims || []).map(claim => `<article class="claim"><div class="claim-kind ${String(claim.classification || 'FACT').toLowerCase()}">${escapeHtml(claim.classification || 'FACT')}</div><p>${escapeHtml(claim.text)}</p><div class="citations">${(claim.evidence_ids || []).map(id => `<span>${escapeHtml(id)}</span>`).join('')}</div></article>`).join('');
  const scenarios = (report.scenario_outlook || []).map(item => `<article class="scenario-card"><span>${escapeHtml(item.probability_band)}</span><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.description)}</p><ul>${(item.triggers || []).map(trigger => `<li>${escapeHtml(trigger)}</li>`).join('')}</ul></article>`).join('');
  const methodology = (report.methodology || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const risks = (report.risks || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  $('#tab-report').innerHTML = `<article class="institutional-report" id="printable-report">
    <div class="report-masthead"><div><b>M9 MACRO RESEARCH</b><span>U.S. Inflation Strategy · Independent research system</span></div><button class="pdf-button" data-export-pdf>⇩ Print / Save PDF</button></div>
    <div class="report-header cpi-report-head"><div><span class="research-kicker">INSTITUTIONAL-STYLE · RESEARCH ONLY · ${escapeHtml(analysis.as_of)}</span><h3>${escapeHtml(report.report_title || '美国 CPI 影响因子专题')}</h3><p>${escapeHtml(report.executive_summary)}</p></div><span class="outcome ${report.status === 'ABSTAIN' ? 'abstain' : ''}">${escapeHtml(report.status)}</span></div>
    ${report.model_error ? `<div class="publication-block"><strong>OPENAI 草稿未生成，报告已 ABSTAIN</strong><p>${escapeHtml(report.model_error)}</p><small>下方数值是确定性 CPI Engine 输出，不是大模型语言。切换到“OpenAI 原始草稿”查看诊断。</small></div>` : ''}
    ${report.fixture_disclaimer ? '<div class="fixture-banner">教学历史数据 · 不代表当前市场；切换 Live 才能生成实时专题</div>' : ''}
    <section class="cpi-hero-metrics"><article><span>Headline YoY</span><strong>${metric(headline.yoy, '%')}</strong><small>${escapeHtml(headline.signal || '')}</small></article><article><span>Headline 3m ann.</span><strong>${metric(headline.momentum_3m_annualized, '%')}</strong><small>短期动量</small></article><article><span>Core YoY</span><strong>${metric(core.yoy, '%')}</strong><small>${escapeHtml(core.signal || '')}</small></article><article><span>Report confidence</span><strong>${metric(Number(report.confidence || 0) * 100, '%')}</strong><small>研究置信度，非概率</small></article></section>
    <div class="cpi-report-grid"><section class="research-section chart-section"><div class="section-title"><span>01</span><div><h4>通胀轨迹</h4><small>Headline 与 Core · 12个月同比</small></div></div>${lineChart(analysis.inflation_chart)}</section><section class="research-section findings-section"><div class="section-title"><span>02</span><div><h4>核心判断</h4><small>Facts → Inference</small></div></div><ol>${findings}</ol></section></div>
    <section class="research-section"><div class="section-title"><span>03</span><div><h4>影响因子仪表盘</h4><small>3m 年化动量、0–6 月最强相关与领先期；不等于因果贡献</small></div></div><div class="factor-table-wrap"><table class="factor-table"><thead><tr><th>Factor</th><th>YoY</th><th>3m ann.</th><th>Signal</th><th>Corr / lag</th><th>Pressure</th></tr></thead><tbody>${factorRows}</tbody></table></div></section>
    <section class="research-section"><div class="section-title"><span>04</span><div><h4>证据化论点</h4><small>每项结论标记事实、推断或情景，并绑定 Evidence ID</small></div></div><div class="claim-list">${claims || '<article class="claim"><p>没有通过发布门禁的研究结论。</p></article>'}</div></section>
    <section class="research-section"><div class="section-title"><span>05</span><div><h4>三情景展望</h4><small>概率带未校准，不作为投资信号</small></div></div><div class="scenario-grid">${scenarios}</div></section>
    <div class="cpi-report-grid"><section class="research-section prose-list"><div class="section-title"><span>06</span><div><h4>方法</h4><small>可复算的确定性计算</small></div></div><ul>${methodology}</ul></section><section class="research-section prose-list risks-list"><div class="section-title"><span>07</span><div><h4>局限与反方风险</h4><small>必须披露</small></div></div><ul>${risks}</ul></section></div>
    <div class="report-meta"><span>OpenAI proposal ${report.model_mode === 'live' ? escapeHtml($('#model-id').value) : 'deterministic'}</span><span>Research only</span><span>Automatic execution false</span><span>Effects ${report.effect_count}</span><span>${elapsedMs} ms</span></div>
    <footer class="research-disclaimer">This material is generated for research and education. Statistical association is not causation, and no content is investment advice.</footer></article>`;
}

function exportPdf() {
  const originalTitle = document.title;
  document.title = lastReportTitle.replace(/[\\/:*?"<>|]/g, '-');
  window.addEventListener('afterprint', () => { document.title = originalTitle; }, {once: true});
  window.print();
}

async function loadCheckpoint() {
  if (!activeRunId) return;
  try {
    const response = await fetch(`/api/macro/runs/${activeRunId}`);
    const data = await response.json();
    $('#checkpoint-json').textContent = pretty(data.checkpoint);
  } catch (error) {
    $('#checkpoint-json').textContent = `Checkpoint read failed: ${error.message}`;
  }
}

function setRunning(value) {
  running = value;
  ui.runButton.disabled = value;
  ui.runButton.textContent = value ? '● Runtime running…' : '↻ Run again';
  if (value) setStatus('running', 'RUNNING');
}

function setStatus(kind, label) {
  ui.status.className = `run-status ${kind}`;
  ui.status.innerHTML = `<i></i>${escapeHtml(label)}`;
}

function maybeRememberKeys() {
  if ($('#remember-keys').checked) {
    localStorage.setItem('macroLabKeys', JSON.stringify({
      fred: $('#fred-key').value, news: $('#news-key').value, model: $('#model-key').value,
      modelId: $('#model-id').value, modelUrl: $('#model-url').value,
      modelTimeout: $('#model-timeout').value,
      newsProvider: $('#news-provider').value,
    }));
  } else {
    localStorage.removeItem('macroLabKeys');
  }
}

function restoreLocalKeys() {
  try {
    const raw = localStorage.getItem('macroLabKeys');
    if (!raw) return;
    const data = JSON.parse(raw);
    $('#fred-key').value = data.fred || '';
    $('#news-key').value = data.news || '';
    $('#model-key').value = data.model || '';
    $('#model-id').value = data.modelId || 'gpt-6-astra';
    $('#model-url').value = data.modelUrl || 'https://api.openai.com/v1';
    $('#model-timeout').value = data.modelTimeout || '180';
    $('#news-provider').value = data.newsProvider || '';
    $('#remember-keys').checked = true;
  } catch { localStorage.removeItem('macroLabKeys'); }
}

function updateResearchTemplate() {
  const cpi = $('#research-type').value === 'cpi_deep_dive';
  $('#mission-title').textContent = cpi ? 'CPI 影响因子专题 · 机构级研究流程' : '九项严谨通用原则 · 全链路宏观研究';
  $('#mission-copy').textContent = cpi
    ? 'OpenBB 历史序列 → 动量与领先滞后 → 证据图 → OpenAI 报告 → 批判验证 → 风险发布'
    : 'OpenBB 宏观数据 + OpenBB/官方新闻 → 来源治理 → 证据图 → 模型提议 → 批判验证 → 风险发布';
  $('#question').value = cpi
    ? '研究美国 CPI 的主要影响因子、当前动量、传导时滞与未来情景。'
    : 'Assess the current U.S. inflation-growth-policy regime and its key risks.';
}

ui.runButton.addEventListener('click', run);
ui.resumeButton.addEventListener('click', resume);
ui.eventButton.addEventListener('click', () => ui.eventDetail.classList.toggle('hidden'));
$('#modal-close').addEventListener('click', () => $('#agent-modal').classList.add('hidden'));
$('#agent-modal').addEventListener('click', event => event.target.id === 'agent-modal' && $('#agent-modal').classList.add('hidden'));
$('#research-type').addEventListener('change', updateResearchTemplate);
document.addEventListener('click', event => {
  if (event.target.closest('[data-export-pdf]')) exportPdf();
});
$$('.tabs button').forEach(button => button.addEventListener('click', () => {
  $$('.tabs button').forEach(item => item.classList.toggle('active', item === button));
  $$('.tab-page').forEach(page => page.classList.toggle('active', page.id === `tab-${button.dataset.tab}`));
}));

init().catch(error => {
  setStatus('failure', 'INIT ERROR');
  ui.nowMessage.textContent = error.message;
});
