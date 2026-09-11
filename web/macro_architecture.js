const scene = document.querySelector('#scene');
const canvas = document.querySelector('#architecture-canvas');
const context = canvas.getContext('2d');
const nodeLayer = document.querySelector('#node-layer');

const palette = {
  information: '#48b8ff', decision: '#b18aff', risk: '#ff7b87', state: '#58e0aa',
  grid: 'rgba(95, 132, 151, .16)', plane: 'rgba(74, 123, 145, .055)', text: '#718b99',
};

const nodes = [
  {id:'mission', name:'Research Mission', subtitle:'User intent', icon:'◆', plane:'data', depth:1, p:[-7.7,4.2,0], purpose:'研究问题是输入数据，不直接拥有工具权限。', input:'Natural-language question', output:'Untrusted mission text', authority:'None', principles:[1,8]},
  {id:'openbb_macro', name:'OpenBB Macro', subtitle:'FRED series', icon:'▥', plane:'data', depth:1, p:[-7.7,1.4,-2.4], purpose:'读取 CPI、失业率、政策利率与国债收益率，并标准化观测。', input:'Approved series manifest + FRED key', output:'Macro evidence candidates', authority:'openbb:macro:read', principles:[4,5]},
  {id:'openbb_news', name:'OpenBB News', subtitle:'World news providers', icon:'◉', plane:'data', depth:1, p:[-7.7,-.8,0], purpose:'从批准的 OpenBB 新闻 provider 获取宏观新闻候选。', input:'Query + provider credential', output:'Untrusted news candidates', authority:'openbb:news:read', principles:[4,5,8]},
  {id:'official_rss', name:'Official RSS', subtitle:'Fed · BLS · BEA', icon:'⌁', plane:'data', depth:2, p:[-7.7,-3,2.4], purpose:'读取域名白名单内的政府官方发布，形成独立来源。', input:'Fixed allowlisted feeds', output:'Official evidence candidates', authority:'rss:official:read', principles:[4,5,8]},

  {id:'task_contract', name:'Task Contract', subtitle:'Immutable objective', icon:'▤', plane:'control', depth:2, p:[-4.9,4.4,-.2], purpose:'把任务固化为成功标准、Schema、预算、效果边界和弃权条件。', input:'Research mission', output:'Hashed immutable contract', authority:'PURE compile only', principles:[1,8]},
  {id:'director', name:'研究总监', subtitle:'Mission Director', icon:'🧭', plane:'agent', depth:1, p:[-4.4,2.2,0], purpose:'编译任务契约和七节点有界 DAG，不亲自取数。', input:'Mission', output:'Contract + bounded plan', authority:'plan:compile', principles:[1,2,6]},
  {id:'economist', name:'数据经济学家', subtitle:'OpenBB Economist', icon:'📈', plane:'agent', depth:1, p:[-2.2,.6,-2.1], purpose:'只通过一次性能力票据读取批准的宏观序列。', input:'Contract + series manifest', output:'Macro observations', authority:'openbb:macro:read', principles:[4,5,6]},
  {id:'news_scout', name:'新闻情报员', subtitle:'News Intelligence', icon:'🛰️', plane:'agent', depth:1, p:[-2.2,-1.3,2.1], purpose:'并行读取 OpenBB 与官方 RSS；文章内容永远不是系统指令。', input:'Contract + news manifest', output:'News observations', authority:'news/read only', principles:[4,5,8]},
  {id:'evidence_steward', name:'证据管理员', subtitle:'Evidence Steward', icon:'🗂️', plane:'agent', depth:1, p:[.2,.1,0], purpose:'验证来源、时间、内容哈希、独立性与污染状态。', input:'Macro + news candidates', output:'Evidence graph + quarantine', authority:'evidence:validate', principles:[3,4,6,8]},
  {id:'macro_analyst', name:'宏观分析师', subtitle:'Macro Analyst', icon:'🧠', plane:'agent', depth:1, p:[2.7,.5,0], purpose:'只根据已接受证据生成带 Evidence ID 的研究提议。', input:'Contract + accepted evidence', output:'Report proposal', authority:'analysis:propose', principles:[4,6,7]},
  {id:'critic', name:'反方审查员', subtitle:'Critical Verifier', icon:'🔎', plane:'agent', depth:1, p:[5,.5,0], purpose:'寻找缺失引用、矛盾、证据不足和过度自信。', input:'Proposal + evidence graph', output:'Verification result', authority:'report:verify', principles:[7]},
  {id:'governor', name:'风险治理官', subtitle:'Risk Governor', icon:'🛡️', plane:'agent', depth:1, p:[7.25,.5,0], purpose:'执行九项最终门禁，只能 COMPLETE 或 ABSTAIN，不能增加结论。', input:'Verification + runtime trace', output:'Final report + checks', authority:'report:publish', principles:[7,8,9]},

  {id:'capability', name:'Capability Gate', subtitle:'One-use ticket', icon:'◇', plane:'control', depth:2, p:[-2.2,-3.4,-2.1], purpose:'Runtime 按 run、contract、agent、tool 签发一次性最小权限票据。', input:'Agent + tool request', output:'Allow or reject', authority:'Runtime only', principles:[5,8]},
  {id:'handoff', name:'Handoff Gate', subtitle:'Typed envelope', icon:'⇄', plane:'control', depth:2, p:[.1,-3.4,1.3], purpose:'验证允许路线、Envelope 哈希与权限不升级。', input:'Sender + receiver + payload', output:'Accepted/rejected handoff', authority:'No delegated escalation', principles:[6,8]},
  {id:'taint_gate', name:'Taint Gate', subtitle:'Injection quarantine', icon:'⚠', plane:'control', depth:2, p:[.1,-3.4,-1.3], purpose:'将外部文本视为不可信数据；恶意指令进入隔离区。', input:'Evidence candidates', output:'Clean or quarantined', authority:'Reject only', principles:[4,8]},
  {id:'verifier', name:'Verification Gate', subtitle:'Citation · coverage', icon:'✓', plane:'control', depth:2, p:[4.9,-3.4,-1.3], purpose:'确定性检查引用、覆盖度、独立来源、置信度和矛盾披露。', input:'Proposal + accepted IDs', output:'Passed + reasons', authority:'No claim rewriting', principles:[7,8]},
  {id:'principle_gate', name:'9-Principle Gate', subtitle:'Machine conformance', icon:'⑨', plane:'control', depth:2, p:[7.2,-3.4,1.3], purpose:'逐项产生可机器复核的 9/9 证据，而不是自我宣称安全。', input:'State + trace + verification', output:'Nine check results', authority:'Publish/abstain boundary', principles:[1,2,3,4,5,6,7,8,9]},

  {id:'deterministic', name:'Deterministic Model', subtitle:'No-key baseline', icon:'ƒ', plane:'model', depth:3, p:[1.6,4.4,-2.2], purpose:'提供可重复的教学基线，用于 Golden behavior 与回归。', input:'Accepted evidence', output:'Deterministic proposal', authority:'Proposal only', principles:[2,7]},
  {id:'llm', name:'Optional LLM', subtitle:'OpenAI-compatible', icon:'✦', plane:'model', depth:3, p:[3.8,4.4,1.7], purpose:'大模型只生成 JSON 提议；Runtime 不接受模型自授权限。', input:'Redacted evidence context', output:'Untrusted proposal JSON', authority:'No tool or publish authority', principles:[2,7,8]},
  {id:'evidence_graph', name:'Evidence Graph', subtitle:'Source → claim', icon:'⌘', plane:'state', depth:3, p:[.2,-5.8,-.2], purpose:'保存来源、时间、哈希、污染状态和 Claim 引用边。', input:'Governed candidates', output:'Traceable evidence IDs', authority:'Append via Runtime', principles:[3,4,7]},
  {id:'journal', name:'NDJSON Journal', subtitle:'Persist before publish', icon:'≣', plane:'state', depth:4, p:[2.7,-5.8,-2.1], purpose:'每个事件先落盘，再通过 NDJSON 发给 UI，Trace 是可重放事实。', input:'Runtime event', output:'Ordered durable event', authority:'Append only', principles:[3,9]},
  {id:'checkpoint', name:'Checkpoint', subtitle:'Atomic resume state', icon:'↻', plane:'state', depth:4, p:[5,-5.8,0], purpose:'在边界原子保存状态；恢复时跳过已经成功的工具调用。', input:'Redacted runtime state', output:'Resume point', authority:'Runtime state only', principles:[3,9]},
  {id:'memory', name:'Long-term Memory', subtitle:'Redacted metadata', icon:'◫', plane:'state', depth:4, p:[7.2,-5.8,2.1], purpose:'长期层只保留脱敏摘要，不保存原始文章或 API Key。', input:'Safe run metadata', output:'Redacted memory record', authority:'No credentials', principles:[3,8,9]},

  {id:'report', name:'Research Report', subtitle:'Complete / abstain', icon:'▣', plane:'delivery', depth:1, p:[9.55,2.2,0], purpose:'最终研究交付；明确 research_only、置信度、风险和引用。', input:'Governor decision', output:'COMPLETE or ABSTAIN', authority:'Zero execution', principles:[4,7,8]},
  {id:'console', name:'Agent Console', subtitle:'Live three-flow UI', icon:'▦', plane:'delivery', depth:5, p:[9.55,-.2,-2.1], purpose:'实时显示信息流、决策流、风险流、Agent 状态与持久化 Trace。', input:'NDJSON events', output:'Operator visualization', authority:'Run/resume request only', principles:[6,9]},
  {id:'atlas', name:'3D Architecture', subtitle:'Engineering atlas', icon:'◈', plane:'delivery', depth:5, p:[9.55,-2.7,2.1], purpose:'用空间结构解释模块边界、数据方向、权限门禁和恢复路径。', input:'Static contracts + manifest', output:'Inspectable system map', authority:'Read only', principles:[1,2,5,6,8,9]},
];

const edges = [
  ['mission','director','decision'], ['director','task_contract','decision'],
  ['task_contract','economist','decision'], ['task_contract','news_scout','decision'],
  ['openbb_macro','economist','information'], ['openbb_news','news_scout','information'],
  ['official_rss','news_scout','information'], ['economist','evidence_steward','information'],
  ['news_scout','evidence_steward','information'], ['evidence_steward','macro_analyst','information'],
  ['deterministic','macro_analyst','decision'], ['llm','macro_analyst','decision'],
  ['macro_analyst','critic','decision'], ['critic','governor','decision'], ['governor','report','decision'],
  ['capability','economist','risk'], ['capability','news_scout','risk'],
  ['handoff','evidence_steward','risk'], ['taint_gate','evidence_steward','risk'],
  ['verifier','critic','risk'], ['principle_gate','governor','risk'],
  ['evidence_steward','evidence_graph','information'], ['evidence_graph','macro_analyst','information'],
  ['director','journal','information'], ['evidence_steward','journal','information'],
  ['governor','journal','information'], ['journal','checkpoint','information'],
  ['checkpoint','memory','information'], ['journal','console','information'], ['principle_gate','atlas','information'],
];

const chapters = [
  {label:'01 · FORMALIZE', title:'先把问题变成不可变契约', copy:'研究总监固化目标、预算、输出 Schema、权限边界与 ABSTAIN 条件。', focus:['mission','director','task_contract']},
  {label:'02 · COLLECT', title:'两个只读分支并行取证', copy:'数据经济学家读取 OpenBB 宏观序列；新闻情报员读取 OpenBB 与官方 RSS。', focus:['openbb_macro','openbb_news','official_rss','economist','news_scout','capability']},
  {label:'03 · GOVERN EVIDENCE', title:'外部内容先过证据与污染门', copy:'来源、时效、哈希和独立性通过后才形成 Evidence Graph；恶意指令只会进入隔离区。', focus:['evidence_steward','taint_gate','evidence_graph','handoff']},
  {label:'04 · PROPOSE', title:'模型只有提议权，没有执行权', copy:'确定性基线或可选 LLM 只能引用已接受 Evidence ID 生成 Proposal。', focus:['deterministic','llm','macro_analyst','evidence_graph']},
  {label:'05 · VERIFY', title:'反方审查与九项门禁决定是否发布', copy:'Critic 检查引用和证据覆盖，Governor 只能 COMPLETE 或 ABSTAIN。', focus:['critic','verifier','governor','principle_gate','report']},
  {label:'06 · PERSIST & RESUME', title:'Trace 先落盘，Checkpoint 再恢复', copy:'事件先持久化再推流；中断后从已保存边界继续，绝不重放已完成工具副作用。', focus:['journal','checkpoint','memory','console']},
  {label:'07 · FULL SYSTEM', title:'九项严谨原则形成一套控制系统', copy:'任务、计划、记忆、证据、工具、交接、验证、安全与治理在同一张可复核架构图上闭环。', focus:nodes.map(node => node.id)},
];

const byId = new Map(nodes.map(node => [node.id, node]));
const nodeElements = new Map();
const flowVisible = {information:true, decision:true, risk:true};
let camera = {yaw:-.28, pitch:.17, zoom:52};
let viewport = {width:1, height:1, dpr:1};
let initialFitPending = true;
let pointer = null;
const activePointers = new Map();
let pinchDistance = null;
let flowRunning = true;
let speed = 1;
let depth = 5;
let selectedId = null;
let storyStart = 0;
let storyActive = false;
let storyFrame = 0;
let lastTime = performance.now();

function createNodes() {
  nodeLayer.innerHTML = '';
  nodes.forEach(node => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'arch-node';
    button.dataset.archNode = node.id;
    button.dataset.plane = node.plane;
    button.setAttribute('aria-label', `${node.name}: ${node.subtitle}`);
    button.innerHTML = `<span class="node-icon">${node.icon}</span><span class="node-copy"><strong>${node.name}</strong><small>${node.subtitle}</small></span>`;
    button.addEventListener('click', event => { event.stopPropagation(); selectNode(node.id); });
    nodeLayer.appendChild(button);
    nodeElements.set(node.id, button);
  });
}

function resize() {
  const rect = scene.getBoundingClientRect();
  viewport = {width:rect.width, height:rect.height, dpr:Math.min(window.devicePixelRatio || 1, 2)};
  canvas.width = Math.round(rect.width * viewport.dpr);
  canvas.height = Math.round(rect.height * viewport.dpr);
  context.setTransform(viewport.dpr,0,0,viewport.dpr,0,0);
  if (initialFitPending) {
    camera.zoom=fitZoom();
    initialFitPending=false;
  }
}

function fitZoom() {
  return Math.max(24,Math.min(58,viewport.width/21,viewport.height/14));
}

function project(point) {
  const [x,y,z] = point;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const rx = x * cy - z * sy;
  const rz = x * sy + z * cy;
  const ry = y * cp - rz * sp;
  const depthValue = y * sp + rz * cp;
  const perspective = 11 / Math.max(4.5, 11 + depthValue * .14);
  const scale = camera.zoom * perspective;
  return {x:viewport.width/2 + rx*scale, y:viewport.height/2 - ry*scale + 25, z:depthValue, scale:perspective};
}

function drawGrid() {
  context.save();
  context.strokeStyle = palette.grid;
  context.lineWidth = 1;
  for (let x=-11; x<=11; x+=1) drawLine([x,-6.9,-4.8],[x,-6.9,4.8]);
  for (let z=-5; z<=5; z+=1) drawLine([-11,-6.9,z],[11,-6.9,z]);
  context.restore();
}

function drawLine(a,b) {
  const p1=project(a), p2=project(b);
  context.beginPath(); context.moveTo(p1.x,p1.y); context.lineTo(p2.x,p2.y); context.stroke();
}

function drawPlanes() {
  const planes = [
    {name:'DATA SOURCES', y:5.15, a:[-8.8,5.15,-3.4], b:[-6.5,5.15,-3.4]},
    {name:'AGENT ORCHESTRATION', y:5.15, a:[-5.2,5.15,-.4], b:[7.8,5.15,-.4]},
    {name:'CONTROL PLANE', y:-4.3, a:[-3.2,-4.3,-2.7], b:[7.8,-4.3,-2.7]},
    {name:'STATE & RECOVERY', y:-6.85, a:[-.8,-6.85,-2.7], b:[7.8,-6.85,-2.7]},
    {name:'DELIVERY', y:3.2, a:[9,3.2,-2.8], b:[10.5,3.2,-2.8]},
  ];
  context.save();
  context.font = '10px ui-monospace, monospace';
  context.fillStyle = palette.text;
  planes.forEach(plane => {
    const a=project(plane.a), b=project(plane.b);
    context.globalAlpha=.75;
    context.fillText(plane.name,a.x,a.y);
    context.strokeStyle='rgba(104,145,164,.22)';
    context.beginPath(); context.moveTo(a.x,a.y+8); context.lineTo(b.x,b.y+8); context.stroke();
  });
  context.restore();
}

function edgeVisible(edge) {
  const from=byId.get(edge[0]), to=byId.get(edge[1]);
  return flowVisible[edge[2]] && from.depth<=depth && to.depth<=depth;
}

function drawEdges(time) {
  edges.forEach((edge,index) => {
    if (!edgeVisible(edge)) return;
    const from=project(byId.get(edge[0]).p), to=project(byId.get(edge[1]).p);
    const color=palette[edge[2]];
    const focused=!storyActive || chapters[storyFrame]?.focus.includes(edge[0]) || chapters[storyFrame]?.focus.includes(edge[1]);
    context.save();
    context.globalAlpha=focused?.5:.08;
    context.strokeStyle=color;
    context.lineWidth=focused?1.5:1;
    context.beginPath(); context.moveTo(from.x,from.y); context.lineTo(to.x,to.y); context.stroke();
    if (flowRunning && focused) {
      const t=((time*.00013*speed)+(index*.137))%1;
      const x=from.x+(to.x-from.x)*t, y=from.y+(to.y-from.y)*t;
      context.globalAlpha=.95; context.fillStyle=color; context.shadowColor=color; context.shadowBlur=12;
      context.beginPath(); context.arc(x,y,2.5,0,Math.PI*2); context.fill();
    }
    context.restore();
  });
}

function layoutNodes() {
  nodes.forEach(node => {
    const element=nodeElements.get(node.id);
    const p=project(node.p);
    const visible=node.depth<=depth;
    element.classList.toggle('hidden-depth',!visible);
    element.classList.toggle('story-focus',storyActive && chapters[storyFrame]?.focus.includes(node.id));
    element.classList.toggle('dimmed',storyActive && !chapters[storyFrame]?.focus.includes(node.id));
    element.style.left=`${p.x}px`;
    element.style.top=`${p.y}px`;
    element.style.zIndex=String(Math.round(100-p.z*3));
    element.style.transform=`translate(-50%,-50%) scale(${Math.max(.58,Math.min(1.08,p.scale))})`;
  });
}

function render(time) {
  context.clearRect(0,0,viewport.width,viewport.height);
  drawGrid(); drawPlanes(); drawEdges(time); layoutNodes();
  if (storyActive) updateStory(time);
  lastTime=time;
  requestAnimationFrame(render);
}

function selectNode(id) {
  selectedId=id;
  const node=byId.get(id);
  nodeElements.forEach((element,key) => element.classList.toggle('selected',key===id));
  document.querySelector('#inspector-plane').textContent=`${node.plane.toUpperCase()} PLANE`;
  document.querySelector('#inspector-icon').textContent=node.icon;
  document.querySelector('#inspector-name').textContent=node.name;
  document.querySelector('#inspector-subtitle').textContent=node.subtitle;
  document.querySelector('#inspector-purpose').textContent=node.purpose;
  document.querySelector('#inspector-input').textContent=node.input;
  document.querySelector('#inspector-output').textContent=node.output;
  document.querySelector('#inspector-authority').textContent=node.authority;
  document.querySelector('#inspector-principles').textContent=node.principles.map(value=>`P${value}`).join(' · ');
  document.querySelector('#inspector').classList.add('open');
}

function resetOverview() {
  camera={yaw:-.28,pitch:.17,zoom:fitZoom()};
  stopStory();
  document.querySelector('#chapter-label').textContent='SYSTEM OVERVIEW · 26 MODULES';
  document.querySelector('#chapter-title').textContent='严谨宏观研究 Agent 的完整工程剖面';
  document.querySelector('#chapter-copy').textContent='拖动空间旋转，滚轮或双指缩放；点击任一模块查看输入、输出、权限和九项原则映射。';
}

function startStory() {
  storyActive=true; storyStart=performance.now(); storyFrame=0;
  depth=5; document.querySelector('#depth-slider').value='5'; updateDepthLabel();
  document.querySelector('#story-button').innerHTML='■ <span>Stop story</span><small>playing</small>';
}

function stopStory() {
  storyActive=false;
  document.querySelector('#story-button').innerHTML='▶ <span>Story mode</span><small>55 sec</small>';
  document.querySelector('#story-progress').style.width='0';
  nodeElements.forEach(element => element.classList.remove('story-focus','dimmed'));
}

function updateStory(time) {
  const duration=55000;
  const progress=Math.min(1,(time-storyStart)/duration);
  const nextFrame=Math.min(chapters.length-1,Math.floor(progress*chapters.length));
  if (nextFrame!==storyFrame || lastTime===0) {
    storyFrame=nextFrame;
    const chapter=chapters[storyFrame];
    document.querySelector('#chapter-label').textContent=chapter.label;
    document.querySelector('#chapter-title').textContent=chapter.title;
    document.querySelector('#chapter-copy').textContent=chapter.copy;
  }
  camera.yaw+=.00007*(time-lastTime)*speed;
  document.querySelector('#story-progress').style.width=`${progress*100}%`;
  if (progress>=1) stopStory();
}

function updateDepthLabel() {
  const labels=['Core path','+ Runtime gates','+ Model & evidence','+ State & recovery','Full system'];
  document.querySelector('#depth-output').textContent=labels[depth-1];
}

scene.addEventListener('pointerdown', event => {
  if (event.target.closest('.arch-node') || event.target.closest('.inspector')) return;
  activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  scene.setPointerCapture(event.pointerId);
  scene.classList.add('dragging');
  stopStory();
  if (activePointers.size===1) {
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY};
  } else if (activePointers.size===2) {
    const [first,second]=[...activePointers.values()];
    pinchDistance=Math.hypot(second.x-first.x,second.y-first.y);
    pointer=null;
  }
});
scene.addEventListener('pointermove', event => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if (activePointers.size>=2) {
    const [first,second]=[...activePointers.values()];
    const nextDistance=Math.hypot(second.x-first.x,second.y-first.y);
    if (pinchDistance!==null) camera.zoom=Math.max(24,Math.min(110,camera.zoom+(nextDistance-pinchDistance)*.12));
    pinchDistance=nextDistance;
    return;
  }
  if (!pointer || pointer.id!==event.pointerId) return;
  const dx=event.clientX-pointer.x, dy=event.clientY-pointer.y;
  camera.yaw+=dx*.006; camera.pitch=Math.max(-.55,Math.min(.55,camera.pitch+dy*.004));
  pointer.x=event.clientX; pointer.y=event.clientY;
});
scene.addEventListener('pointerup', event => {
  activePointers.delete(event.pointerId);
  pinchDistance=null;
  if (activePointers.size===1) {
    const [id,position]=[...activePointers.entries()][0];
    pointer={id,x:position.x,y:position.y};
  } else {
    pointer=null;
  }
  if (activePointers.size===0) scene.classList.remove('dragging');
});
scene.addEventListener('pointercancel', event => {
  activePointers.delete(event.pointerId);
  pointer=null;
  pinchDistance=null;
  if (activePointers.size===0) scene.classList.remove('dragging');
});
scene.addEventListener('wheel', event => {
  event.preventDefault(); stopStory(); camera.zoom=Math.max(40,Math.min(110,camera.zoom-event.deltaY*.06));
},{passive:false});

document.querySelector('#overview-button').addEventListener('click',resetOverview);
document.querySelector('#story-button').addEventListener('click',()=>storyActive?stopStory():startStory());
document.querySelector('#inspector-close').addEventListener('click',()=>document.querySelector('#inspector').classList.remove('open'));
document.querySelector('#flow-button').addEventListener('click',event => {
  flowRunning=!flowRunning; event.currentTarget.setAttribute('aria-pressed',String(flowRunning));
  event.currentTarget.textContent=flowRunning?'Ⅱ':'▶';
});
document.querySelectorAll('[data-flow]').forEach(input => input.addEventListener('change',()=>{flowVisible[input.dataset.flow]=input.checked;}));
document.querySelector('#depth-slider').addEventListener('input',event=>{depth=Number(event.target.value);updateDepthLabel();});
document.querySelector('#speed-select').addEventListener('change',event=>{speed=Number(event.target.value);});
window.addEventListener('resize',resize);

createNodes(); resize(); updateDepthLabel(); requestAnimationFrame(render);
