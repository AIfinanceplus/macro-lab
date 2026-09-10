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
  $('#tab-report').innerHTML = '<div class="empty-result"><strong>运行进行中</strong><p>报告必须等待证据、批判与九项门禁完成。</p></div>';
  renderPrinciples(manifest.principles.map(item => ({...item, passed: null})));
  $$('.agent-card').forEach(item => item.classList.remove('active'));
  $$('.lane-route b').forEach(item => item.classList.remove('hot'));
}

function payload() {
  maybeRememberKeys();
  return {
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
  latestClaims = report.claims || [];
  renderEvidence();
  const claims = (report.claims || []).map(claim => `
    <article class="claim"><p>${escapeHtml(claim.text)}</p><div class="citations">${
      (claim.evidence_ids || []).map(id => `<span>${escapeHtml(id)}</span>`).join('')
    }</div></article>`).join('');
  $('#tab-report').innerHTML = `
    <div class="report-header"><div><h3>Macro Regime Research</h3><p>${escapeHtml(report.executive_summary)}</p></div><span class="outcome ${report.status === 'ABSTAIN' ? 'abstain' : ''}">${escapeHtml(report.status)}</span></div>
    <div class="claim-list">${claims || '<article class="claim"><p>没有通过发布门禁的研究结论。</p></article>'}</div>
    <div class="report-meta"><span>Confidence ${Number(report.confidence || 0).toFixed(2)}</span><span>${report.research_only ? 'Research only' : ''}</span><span>Automatic execution ${String(report.automatic_execution)}</span><span>Effects ${report.effect_count}</span><span>${elapsedMs} ms</span></div>`;
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
    $('#model-id').value = data.modelId || 'gpt-5.4-mini';
    $('#model-url').value = data.modelUrl || 'https://api.openai.com/v1';
    $('#news-provider').value = data.newsProvider || '';
    $('#remember-keys').checked = true;
  } catch { localStorage.removeItem('macroLabKeys'); }
}

ui.runButton.addEventListener('click', run);
ui.resumeButton.addEventListener('click', resume);
ui.eventButton.addEventListener('click', () => ui.eventDetail.classList.toggle('hidden'));
$('#modal-close').addEventListener('click', () => $('#agent-modal').classList.add('hidden'));
$('#agent-modal').addEventListener('click', event => event.target.id === 'agent-modal' && $('#agent-modal').classList.add('hidden'));
$$('.tabs button').forEach(button => button.addEventListener('click', () => {
  $$('.tabs button').forEach(item => item.classList.toggle('active', item === button));
  $$('.tab-page').forEach(page => page.classList.toggle('active', page.id === `tab-${button.dataset.tab}`));
}));

init().catch(error => {
  setStatus('failure', 'INIT ERROR');
  ui.nowMessage.textContent = error.message;
});
