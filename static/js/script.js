/* ═══════════════════════════════════════════
   AUTH
═══════════════════════════════════════════ */
const USERS = {
  'admin@fraudsentinel.io': { pass: 'admin123', name: 'Admin' },
  'analyst@bank.com':       { pass: 'analyst123', name: 'Analyst' },
};

function fillDemo(who) {
  const u = who === 'admin'
    ? ['admin@fraudsentinel.io','admin123']
    : ['analyst@bank.com','analyst123'];
  document.getElementById('lgEmail').value = u[0];
  document.getElementById('lgPass').value  = u[1];
  document.getElementById('lgErr').classList.remove('show');
}

function doLogin() {
  const email = document.getElementById('lgEmail').value.trim();
  const pass  = document.getElementById('lgPass').value;
  const u     = USERS[email];
  if (u && u.pass === pass) {
    const pg = document.getElementById('loginPage');
    pg.style.transition = 'opacity .45s ease';
    pg.style.opacity = '0';
    setTimeout(() => {
      pg.style.display = 'none';
      document.getElementById('mainApp').style.display = 'block';
      document.getElementById('tbName').textContent = u.name;
      document.getElementById('tbAv').textContent   = u.name[0];
      tlog('ok', `Authenticated: ${u.name}. Session started.`);
    }, 450);
  } else {
    document.getElementById('lgErr').classList.add('show');
    document.getElementById('lgPass').value = '';
    document.getElementById('lgPass').focus();
  }
}

function doLogout() {
  document.getElementById('mainApp').style.display = 'none';
  const pg = document.getElementById('loginPage');
  pg.style.opacity = '1'; pg.style.display = 'flex';
  document.getElementById('lgEmail').value = '';
  document.getElementById('lgPass').value  = '';
  document.getElementById('lgErr').classList.remove('show');
  resetAll();
}

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let allResults = [], curFilter = 'all', curPage = 1;
let selectedFile = null;
const PAGE_SIZE = 15;

function onDragOver(e)  { e.preventDefault(); document.getElementById('upZone').classList.add('drag'); }
function onDragLeave()  { document.getElementById('upZone').classList.remove('drag'); }
function onDrop(e)      { e.preventDefault(); onDragLeave(); loadFile(e.dataTransfer.files[0]); }
function onFileSelect(e){ loadFile(e.target.files[0]); }

function loadFile(file) {
  clearErr();
  if (!file || !file.name.endsWith('.csv')) { showErr('Please upload a .csv file.'); return; }
  selectedFile = file;
  document.getElementById('fileBadge').classList.remove('hidden');
  document.getElementById('fName').textContent = file.name;
  document.getElementById('runBtn').disabled = false;
  tlog('info', `File prepared for API Transfer: ${file.name}`);
}

async function runPipeline() {
  if (!selectedFile) return;
  document.getElementById('runBtn').disabled = true;
  document.getElementById('pipeSection').classList.remove('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('pipeSection').scrollIntoView({behavior:'smooth'});

  resetPipeline();
  tlog('info', 'Uploading CSV payload to Python API…');
  
  // Pipeline Visual Transitions for UI Feedback
  setStep(0, 'active');
  const formData = new FormData();
  formData.append('file', selectedFile);
  
  try {
      const response = await fetch('/api/pipeline', {
          method: 'POST',
          body: formData
      });
      
      setStep(0, 'done'); setProgress(20);
      setStep(1, 'active'); tlog('info', 'Python processing data (Scaling, Nan fills)…'); await delay(400); 
      setStep(1, 'done'); setProgress(40);
      setStep(2, 'active'); tlog('info', 'Python generating SMOTE classes…'); await delay(400);
      setStep(2, 'done'); setProgress(60);
      setStep(3, 'active'); tlog('info', 'Python fitting Random Forest (10 estimators)…'); await delay(400);
      
      if (!response.ok) {
          throw new Error("API returned status " + response.status);
      }
      
      setStep(3, 'done'); setProgress(80);
      setStep(4, 'active');
      const data = await response.json();
      setStep(4, 'done'); setProgress(90);
      
      setStep(5, 'active');
      tlog('ok', 'JSON loaded successfully! Populating Canvas charts.');
      
      allResults = data.fullPreds;
      curFilter  = 'all'; curPage = 1;
      
      buildResults(data.fullPreds, data.metrics);
      setStep(5, 'done'); setProgress(100);
      
      document.getElementById('resultsSection').classList.remove('hidden');
      document.getElementById('resultsSection').scrollIntoView({behavior:'smooth'});
      
  } catch (error) {
      tlog('err', 'Failed to communicate with Flask API: ' + error.message);
      showErr('Server error: Make sure Flask is running on localhost:5000');
  }
}

/* ═══════════════════════════════════════════
   BUILD RESULTS & ALL CHARTS
═══════════════════════════════════════════ */
function buildResults(fullPreds, metrics) {
  const frauds = fullPreds.filter(r=>r.pred===1);
  const legits  = fullPreds.filter(r=>r.pred===0);
  const fp_pct  = ((frauds.length/fullPreds.length)*100).toFixed(1);

  // Metrics
  document.getElementById('mPrec').textContent   = (metrics.precision*100).toFixed(1)+'%';
  document.getElementById('mRec').textContent    = (metrics.recall*100).toFixed(1)+'%';
  document.getElementById('mF1').textContent     = metrics.f1.toFixed(3);
  document.getElementById('mAuc').textContent    = `PR-AUC: ${metrics.prAUC.toFixed(4)}`;
  document.getElementById('mAcc').textContent    = (metrics.accuracy*100).toFixed(1)+'%';
  document.getElementById('aucBadge').textContent = `AUC = ${metrics.prAUC.toFixed(4)}`;
  document.getElementById('distBadge').textContent = `${fp_pct}% fraud`;
  document.getElementById('lgFraud').textContent  = frauds.length;
  document.getElementById('lgFraudPct').textContent = fp_pct+'%';
  document.getElementById('lgLegit').textContent  = legits.length;
  document.getElementById('lgLegitPct').textContent = (100-parseFloat(fp_pct)).toFixed(1)+'%';
  document.getElementById('dlTotal').textContent  = fullPreds.length;
  document.getElementById('dlFraud').textContent  = frauds.length;

  buildClassReport(metrics);

  drawDonut(frauds.length, legits.length);
  requestAnimationFrame(() => {
    drawConfusionMatrix(metrics.cm);
    drawPRCurve(metrics.prCurve, metrics.prAUC);
    drawHistogram(fullPreds);
    drawGroupedBar(frauds, legits);
    drawScatter(fullPreds);
    drawTimeline(fullPreds);
  });

  renderTable();
}

function buildClassReport(m) {
  // Pull from backend
  const n = m.tn + m.fp + m.fn + m.tp;
  const f_prec = m.tn/(m.tn+m.fn+1e-10);
  const f_rec  = m.tn/(m.tn+m.fp+1e-10);
  const sup0 = m.tn+m.fp, sup1 = m.tp+m.fn;

  const box = document.getElementById('classReport');
  box.innerHTML = `<span class="rh">              precision    recall  f1-score   support</span>

<span class="rv">           0</span>   ${fmt(f_prec)}     ${fmt(f_rec)}     ---     ${String(sup0).padStart(7)}
<span class="rd">           1</span>   ${fmt(m.precision)}     ${fmt(m.recall)}     ${fmt(m.f1)}     ${String(sup1).padStart(7)}

<span class="rw">    accuracy</span>                         ${fmt(m.accuracy)}     ${String(n).padStart(7)}
<span class="rh">Confusion Matrix:  TN=${m.tn}  FP=${m.fp}  FN=${m.fn}  TP=${m.tp}</span>`;
}

function fmt(v) { return v.toFixed(4).padStart(10); }

/* ═══════════════════════════════════════════
   CANVAS CHART HELPERS
═══════════════════════════════════════════ */
function initCanvas(id, h) {
  const cv = document.getElementById(id);
  const W  = cv.parentElement.offsetWidth || 500;
  cv.width = W; cv.height = h;
  return { cv, ctx: cv.getContext('2d'), W, H: h };
}

function gridLines(ctx, pad, W, H, maxV, nLines=4, fmt=v=>Math.round(v)) {
  const cH = H - pad.t - pad.b;
  for (let i=0;i<=nLines;i++) {
    const y = pad.t + cH - (i/nLines)*cH;
    ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke();
    ctx.fillStyle='#475569'; ctx.font='9px Space Mono'; ctx.textAlign='right';
    ctx.fillText(fmt((i/nLines)*maxV), pad.l-4, y+3);
  }
}

/* DONUT */
function drawDonut(fraud, legit) {
  const cv=document.getElementById('donutC'), ctx=cv.getContext('2d');
  const cx=75,cy=75,r=58,th=17,total=fraud+legit;
  const a=(fraud/total)*Math.PI*2;
  ctx.clearRect(0,0,150,150);
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle='#e2e8f0';ctx.lineWidth=th;ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+Math.PI*2-a);ctx.strokeStyle='#00e676';ctx.lineWidth=th;ctx.lineCap='round';ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2+Math.PI*2-a,-Math.PI/2+.01);ctx.strokeStyle='#ff2d55';ctx.lineWidth=th;ctx.lineCap='round';ctx.stroke();
  ctx.fillStyle='#0f172a';ctx.font='bold 14px Syne,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(((fraud/total)*100).toFixed(1)+'%',cx,cy-8);
  ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.fillText('FRAUD',cx,cy+10);
}

/* CONFUSION MATRIX */
function drawConfusionMatrix(cm) {
  const {cv,ctx,W,H}=initCanvas('cmC',200);
  ctx.clearRect(0,0,W,H);
  const labels=['Legitimate (0)','Fraud (1)'];
  const colors=[['rgba(0,230,118,0.2)','rgba(255,45,85,0.15)'],['rgba(255,179,0,0.15)','rgba(0,212,255,0.2)']];
  const pad=40, sz=Math.min((W-pad*2-40)/2,(H-pad*2)/2);
  const ox=pad+40, oy=pad;

  ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='center';
  ctx.fillText('Predicted →',ox+sz,-4);
  ctx.fillText('Actual ↓',ox-20,oy+sz);

  ['Legit','Fraud'].forEach((l,i)=>{
    ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='right';
    ctx.fillText(l,ox-5,oy+i*sz+sz/2+3);
    ctx.textAlign='center';
    ctx.fillText(l,ox+i*sz+sz/2,oy-8);
  });

  const maxV=Math.max(...cm.flat(),1);
  cm.forEach((row,i)=>row.forEach((val,j)=>{
    const x=ox+j*sz, y=oy+i*sz;
    ctx.fillStyle=colors[i][j];ctx.fillRect(x,y,sz,sz);
    ctx.strokeStyle=i===j?'rgba(0,212,255,0.4)':'rgba(255,45,85,0.2)';ctx.lineWidth=1;
    ctx.strokeRect(x,y,sz,sz);
    ctx.fillStyle=i===j?'#0070f3':'#ff2d55';ctx.font=`bold ${Math.min(22,sz/2.5)}px Syne,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(val,x+sz/2,y+sz/2-6);
    ctx.fillStyle='#475569';ctx.font='8px Space Mono';ctx.textBaseline='alphabetic';
    const lbl=[[' TN',' FP'],[' FN',' TP']];
    ctx.fillText(lbl[i][j],x+sz/2,y+sz/2+10);
  }));
}

/* PRECISION-RECALL CURVE */
function drawPRCurve(prCurve, prAUC) {
  const {cv,ctx,W,H}=initCanvas('prC',200);
  const pad={l:42,r:16,t:16,b:36};
  const cW=W-pad.l-pad.r, cH=H-pad.t-pad.b;
  ctx.clearRect(0,0,W,H);
  gridLines(ctx,pad,W,H,1,4,v=>v.toFixed(1));

  ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='center';
  for(let i=0;i<=5;i++) ctx.fillText((i*.2).toFixed(1),pad.l+(i/5)*cW,H-12);
  ctx.fillText('Recall',pad.l+cW/2,H-2);
  ctx.save();ctx.translate(12,pad.t+cH/2);ctx.rotate(-Math.PI/2);ctx.fillText('Precision',0,0);ctx.restore();

  ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(255,179,0,0.3)';ctx.lineWidth=1;
  const base=prCurve.precision[prCurve.precision.length-1]||0.5;
  ctx.beginPath();ctx.moveTo(pad.l,pad.t+cH*(1-base));ctx.lineTo(pad.l+cW,pad.t+cH*(1-base));ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  prCurve.recall.forEach((r,i)=>{
    const x=pad.l+r*cW, y=pad.t+cH*(1-prCurve.precision[i]);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.lineTo(pad.l+cW,pad.t+cH);ctx.lineTo(pad.l,pad.t+cH);ctx.closePath();
  const g=ctx.createLinearGradient(0,pad.t,0,pad.t+cH);
  g.addColorStop(0,'rgba(0,212,255,0.2)');g.addColorStop(1,'rgba(0,212,255,0.02)');
  ctx.fillStyle=g;ctx.fill();

  ctx.beginPath();
  prCurve.recall.forEach((r,i)=>{
    const x=pad.l+r*cW, y=pad.t+cH*(1-prCurve.precision[i]);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.strokeStyle='rgba(0,212,255,0.8)';ctx.lineWidth=2;ctx.stroke();

  ctx.fillStyle='rgba(0,212,255,0.7)';ctx.font='10px Space Mono';ctx.textAlign='left';
  ctx.fillText(`AUC = ${prAUC.toFixed(4)}`,pad.l+8,pad.t+18);
}

/* HISTOGRAM */
function drawHistogram(preds) {
  const {cv,ctx,W,H}=initCanvas('histC',200);
  const pad={l:40,r:12,t:16,b:32};
  const cW=W-pad.l-pad.r, cH=H-pad.t-pad.b;
  const bins=10, counts=Array(bins).fill(0);
  preds.forEach(r=>{counts[Math.min(Math.floor(r.fraudProb*bins),bins-1)]++});
  const maxC=Math.max(...counts,1);
  ctx.clearRect(0,0,W,H);
  gridLines(ctx,pad,W,H,maxC);
  const bw=cW/bins;
  counts.forEach((c,i)=>{
    const x=pad.l+i*bw, bh=(c/maxC)*cH, y=pad.t+cH-bh;
    const pct=i/bins;
    const g=ctx.createLinearGradient(0,y,0,y+bh);
    g.addColorStop(0,pct>=.5?'rgba(255,45,85,0.85)':'rgba(0,212,255,0.75)');
    g.addColorStop(1,pct>=.5?'rgba(255,45,85,0.3)':'rgba(0,212,255,0.2)');
    ctx.fillStyle=g;ctx.fillRect(x+2,y,bw-4,bh);
  });
  ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='center';
  for(let i=0;i<=bins;i+=2) ctx.fillText((i*10)+'%',pad.l+i*bw,H-12);
  ctx.fillText('Fraud Probability',pad.l+cW/2,H-2);

  const tx=pad.l+cW*0.5;
  ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(255,183,0,0.5)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(tx,pad.t);ctx.lineTo(tx,pad.t+cH);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='rgba(255,183,0,0.6)';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.fillText('50%',tx+3,pad.t+12);
}

/* GROUPED BAR */
function drawGroupedBar(frauds, legits) {
  const {cv,ctx,W,H}=initCanvas('barC',200);
  const pad={l:44,r:12,t:28,b:36};
  const cW=W-pad.l-pad.r, cH=H-pad.t-pad.b;
  const ranges=[{l:'$0–50',min:0,max:50},{l:'$50–200',min:50,max:200},{l:'$200–500',min:200,max:500},{l:'$500–1k',min:500,max:1e3},{l:'$1k+',min:1e3,max:Infinity}];
  const fC=ranges.map(r=>frauds.filter(f=>f.amount>=r.min&&f.amount<r.max).length);
  const lC=ranges.map(r=>legits.filter(f=>f.amount>=r.min&&f.amount<r.max).length);
  const maxV=Math.max(...fC,...lC,1);
  ctx.clearRect(0,0,W,H);
  gridLines(ctx,pad,W,H,maxV);
  const gw=cW/ranges.length, bw=(gw-10)/2;
  ranges.forEach((r,i)=>{
    const gx=pad.l+i*gw+5;
    [[fC[i],'rgba(255,45,85,0.8)'],[lC[i],'rgba(0,230,118,0.7)']].forEach(([c,col],j)=>{
      const bh=(c/maxV)*cH,x=gx+j*(bw+2),y=pad.t+cH-bh;
      ctx.fillStyle=col;ctx.fillRect(x,y,bw,bh);
    });
    ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='center';
    ctx.fillText(r.l,gx+gw/2-3,H-10);
  });
  [[pad.l,'rgba(255,45,85,0.8)','Fraud'],[pad.l+58,'rgba(0,230,118,0.7)','Legit']].forEach(([x,c,lbl])=>{
    ctx.fillStyle=c;ctx.fillRect(x,7,9,9);
    ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.fillText(lbl,x+13,15);
  });
}

/* SCATTER */
function drawScatter(preds) {
  const {cv,ctx,W,H}=initCanvas('scatterC',200);
  const pad={l:38,r:16,t:16,b:32};
  const cW=W-pad.l-pad.r, cH=H-pad.t-pad.b;
  const v1s=preds.map(r=>r.v1), v3s=preds.map(r=>r.v3);
  const v1min=Math.min(...v1s),v1max=Math.max(...v1s)+1e-6;
  const v3min=Math.min(...v3s),v3max=Math.max(...v3s)+1e-6;
  ctx.clearRect(0,0,W,H);
  for(let i=0;i<=4;i++){
    const y=pad.t+(i/4)*cH,x=pad.l+(i/4)*cW;
    ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+cW,y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,pad.t+cH);ctx.stroke();
  }
  const sample=preds.length>300?preds.filter((_,i)=>i%Math.ceil(preds.length/300)===0):preds;
  sample.forEach(r=>{
    const x=pad.l+((r.v1-v1min)/(v1max-v1min))*cW;
    const y=pad.t+cH-((r.v3-v3min)/(v3max-v3min))*cH;
    ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);
    ctx.fillStyle=r.pred===1?`rgba(255,45,85,${0.4+r.fraudProb*.55})`:`rgba(0,230,118,${0.25+r.fraudProb*.2})`;
    ctx.fill();
  });
  ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='center';ctx.fillText('V1',pad.l+cW/2,H-8);
  ctx.save();ctx.translate(12,pad.t+cH/2);ctx.rotate(-Math.PI/2);ctx.fillText('V3',0,0);ctx.restore();
  [[W-80,'rgba(255,45,85,0.8)','Fraud'],[W-80+52,'rgba(0,230,118,0.7)','Legit']].forEach(([x,c,l])=>{
    ctx.beginPath();ctx.arc(x,12,4,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();
    ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.fillText(l,x+8,15);
  });
}

/* TIMELINE */
function drawTimeline(preds) {
  const {cv,ctx,W,H}=initCanvas('lineC',150);
  const pad={l:42,r:18,t:16,b:36};
  const cW=W-pad.l-pad.r, cH=H-pad.t-pad.b;
  const pts=preds.length>500?preds.filter((_,i)=>i%Math.ceil(preds.length/500)===0):preds;
  ctx.clearRect(0,0,W,H);
  gridLines(ctx,pad,W,H,100,4,v=>v+'%');

  const ty=pad.t+cH*0.5;
  ctx.setLineDash([5,5]);ctx.strokeStyle='rgba(255,183,0,0.35)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(pad.l,ty);ctx.lineTo(pad.l+cW,ty);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='rgba(255,183,0,0.5)';ctx.font='9px Space Mono';ctx.textAlign='left';ctx.fillText('50%',pad.l+4,ty-4);

  ctx.beginPath();
  pts.forEach((r,i)=>{const x=pad.l+(i/(pts.length-1||1))*cW,y=pad.t+cH-r.fraudProb*cH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});
  ctx.lineTo(pad.l+cW,pad.t+cH);ctx.lineTo(pad.l,pad.t+cH);ctx.closePath();
  const g=ctx.createLinearGradient(0,pad.t,0,pad.t+cH);
  g.addColorStop(0,'rgba(0,212,255,0.15)');g.addColorStop(1,'rgba(0,212,255,0.01)');
  ctx.fillStyle=g;ctx.fill();

  ctx.beginPath();
  pts.forEach((r,i)=>{const x=pad.l+(i/(pts.length-1||1))*cW,y=pad.t+cH-r.fraudProb*cH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});
  ctx.strokeStyle='rgba(0,212,255,0.65)';ctx.lineWidth=1.5;ctx.stroke();

  pts.forEach((r,i)=>{
    if(r.pred===1){const x=pad.l+(i/(pts.length-1||1))*cW,y=pad.t+cH-r.fraudProb*cH;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=`rgba(255,45,85,${0.5+r.fraudProb*.45})`;ctx.fill()}
  });
  ctx.fillStyle='#475569';ctx.font='9px Space Mono';ctx.textAlign='center';ctx.fillText('Transaction Index',pad.l+cW/2,H-8);
}

/* ═══════════════════════════════════════════
   TABLE
═══════════════════════════════════════════ */
function getFiltered() {
  if (curFilter==='fraud') return allResults.filter(r=>r.pred===1);
  if (curFilter==='legit') return allResults.filter(r=>r.pred===0);
  return allResults;
}

function setFilter(f) {
  curFilter=f; curPage=1;
  document.querySelectorAll('.f-btn').forEach(b=>b.className='f-btn');
  if(f==='fraud') document.getElementById('fFraud').className='f-btn fd';
  else if(f==='legit') document.getElementById('fLegit').className='f-btn fa';
  else document.getElementById('fAll').className='f-btn fa';
  renderTable();
}

function renderTable() {
  const data=getFiltered(), tp=Math.ceil(data.length/PAGE_SIZE), st=(curPage-1)*PAGE_SIZE;
  const pg=data.slice(st,st+PAGE_SIZE);
  document.getElementById('tCount').textContent=`${data.length} records`;
  document.getElementById('tInfo').textContent=`Showing ${st+1}–${Math.min(st+PAGE_SIZE,data.length)} of ${data.length}`;
  const body=document.getElementById('tBody'); body.innerHTML='';
  pg.forEach((r,i)=>{
    const fraud=r.pred===1;
    const pp=(r.fraudProb*100).toFixed(1);
    const pc=r.fraudProb>.7?'var(--danger)':r.fraudProb>.4?'var(--warn)':'var(--safe)';
    const risk=r.fraudProb>.8?'🔴 HIGH':r.fraudProb>.5?'🟡 MED':'🟢 LOW';
    const tc=r.trueLabel!==null?(r.trueLabel===1?'<span style="color:var(--danger)">Fraud (1)</span>':'<span style="color:var(--safe)">Legit (0)</span>'):'<span style="color:var(--dim)">—</span>';
    const tr=document.createElement('tr');
    if(fraud) tr.className='fr-row';
    tr.innerHTML=`<td style="color:var(--muted)">${st+i+1}</td>
      <td>$${r.amount.toFixed(2)}</td>
      <td>${tc}</td>
      <td><span class="badge ${fraud?'badge-f':'badge-s'}">${fraud?'⚠ FRAUD':'✓ LEGIT'}</span></td>
      <td><div class="prob-wrap"><div class="prob-track"><div class="prob-fill" style="width:${pp}%;background:${pc}"></div></div><span style="color:${pc};font-size:11px">${pp}%</span></div></td>
      <td style="font-size:11px">${risk}</td>`;
    body.appendChild(tr);
  });
  const pag=document.getElementById('tPag'); pag.innerHTML='';
  for(let p=1;p<=Math.min(tp,7);p++){
    const b=document.createElement('button');b.className='pg-btn'+(p===curPage?' act':'');b.textContent=p;b.onclick=()=>{curPage=p;renderTable()};pag.appendChild(b);
  }
  if(tp>7){const e=document.createElement('button');e.className='pg-btn';e.textContent='…';pag.appendChild(e)}
}

/* ═══════════════════════════════════════════
   PIPELINE UI
═══════════════════════════════════════════ */
function resetPipeline() {
  for(let i=0;i<6;i++){
    const el=document.getElementById(`ps${i}`);
    if (el) {
        el.className='pipe-step';
        el.querySelector('.pipe-dot').textContent='0'+(i+1);
    }
  }
  document.getElementById('progBar').style.width='0%';
  document.getElementById('terminal').innerHTML='';
}

function setStep(n, state) {
  const el=document.getElementById(`ps${n}`);
  if(el) {
      el.className=`pipe-step ${state}`;
      if(state==='done') el.querySelector('.pipe-dot').textContent='✓';
  }
}

function setProgress(pct) { document.getElementById('progBar').style.width=pct+'%'; }

function tlog(type, msg) {
  const term=document.getElementById('terminal');
  if(!term) return;
  const now=new Date().toLocaleTimeString('en-US',{hour12:false});
  const map={ok:'tok',warn:'twarn',err:'terr',info:'tinfo'};
  const pre={ok:'[OK]  ',warn:'[WARN]',err:'[ERR] ',info:'[INFO]'};
  const div=document.createElement('div');div.className='t-line';
  div.innerHTML=`<span class="t-ts">${now}</span><span class="${map[type]}">${pre[type]}</span><span>${msg}</span>`;
  term.appendChild(div); term.scrollTop=term.scrollHeight;
}

function delay(ms) { return new Promise(r=>setTimeout(r,ms)); }

/* ═══════════════════════════════════════════
   DOWNLOAD
═══════════════════════════════════════════ */
function dlReport(type) {
  const data=type==='fraud'?allResults.filter(r=>r.pred===1):allResults;
  let csv='Amount,TrueClass,Prediction,Probability,RiskLevel\n';
  data.forEach((r,i)=>{
    const risk=r.fraudProb>.8?'HIGH':r.fraudProb>.5?'ELEVATED':'LOW';
    csv+=`${r.amount.toFixed(2)},${r.trueLabel!==null?r.trueLabel:'N/A'},${r.pred},${(r.fraudProb*100).toFixed(2)}%,${risk}\n`;
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`fraudsentinel_${type}_${Date.now()}.csv`;a.click();
  tlog('ok',`Downloaded ${type} report: ${data.length} records`);
}

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
function showErr(m){const e=document.getElementById('errAlert');e.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${m}`;e.classList.remove('hidden')}
function clearErr(){document.getElementById('errAlert').classList.add('hidden')}

function resetAll() {
  selectedFile=null; allResults=[];
  document.getElementById('fileBadge').classList.add('hidden');
  document.getElementById('runBtn').disabled=true;
  document.getElementById('pipeSection').classList.add('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('fileInput').value='';
  clearErr();
  const t=document.getElementById('terminal');if(t) t.innerHTML='';
}

/* ═══════════════════════════════════════════
   MANUAL PREDICTION
═══════════════════════════════════════════ */
async function testSingleTxn() {
  const errBox = document.getElementById('mp_err');
  const resBox = document.getElementById('mp_result');
  errBox.classList.add('hidden');
  
  resBox.className = 'res-box';
  resBox.innerHTML = `<div class="rb-title" style="color:var(--text)">Evaluating...</div><div class="rb-sub">Running Scikit-Learn Inference</div>`;
  
  const payload = {
    amount: parseFloat(document.getElementById('mp_amount').value),
    loc_risk: parseFloat(document.getElementById('mp_loc').value),
    behavior: parseFloat(document.getElementById('mp_behavior').value),
    device: parseFloat(document.getElementById('mp_device').value),
    merchant: parseFloat(document.getElementById('mp_merchant').value),
    failed: parseFloat(document.getElementById('mp_failed').value)
  };

  try {
    const response = await fetch('/api/predict_single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unknown server error");

    if (data.prediction === 1) {
       resBox.className = 'res-box fraud';
       resBox.innerHTML = `
          <div class="rb-icon">🚨</div>
          <div class="rb-title" style="color:var(--danger)">Fraud Detected</div>
          <div class="rb-sub">Confidence: <strong>${(data.probability*100).toFixed(1)}%</strong></div>
       `;
    } else {
       resBox.className = 'res-box safe';
       resBox.innerHTML = `
          <div class="rb-icon">✅</div>
          <div class="rb-title" style="color:var(--safe)">Genuine Transaction</div>
          <div class="rb-sub">Fraud Probability: <strong>${(data.probability*100).toFixed(1)}%</strong></div>
       `;
    }
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
    resBox.innerHTML = `<div class="rb-title" style="color:var(--text)">Error</div><div class="rb-sub">Check status</div>`;
  }
}

// Redraw on resize
let _rzTimer;
window.addEventListener('resize',()=>{
  clearTimeout(_rzTimer);
  _rzTimer=setTimeout(()=>{
    if(allResults.length) {
      const m=document.getElementById('mPrec');
      if(m&&m.textContent!=='—') {
        drawDonut(allResults.filter(r=>r.pred===1).length, allResults.filter(r=>r.pred===0).length);
        requestAnimationFrame(()=>{
          drawHistogram(allResults);
          drawGroupedBar(allResults.filter(r=>r.pred===1),allResults.filter(r=>r.pred===0));
          drawScatter(allResults);
          drawTimeline(allResults);
        });
      }
    }
  },250);
});