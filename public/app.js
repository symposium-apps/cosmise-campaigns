(() => {
  const ui = { state: null, report: null };
  const $ = (selector) => document.querySelector(selector);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const statusLabel = (value) => ({ queued:'Waiting', writing:'Working', reviewing:'Reviewing', ready:'Ready', failed:'Failed' }[value] || value || 'Draft');
  function toast(message) { const node=$('#toast'); node.textContent=message; node.hidden=false; clearTimeout(ui.toast); ui.toast=setTimeout(()=>node.hidden=true,3500); }
  async function request(url, options) { const response=await fetch(url,options); const body=await response.json().catch(()=>({})); if(!response.ok) throw new Error(body.error||'Request failed'); return body; }

  function activeMetadata() {
    const id=ui.state?.view?.active_report_id;
    return (ui.state?.reports||[]).find((report)=>report.id===id)||null;
  }

  function renderConnection() {
    const connection=ui.state?.connection||{};
    $('#connection').innerHTML=`<span class="dot ${escape(connection.state)}"></span><div><strong>${connection.state==='ready'?'Read-only connection ready':connection.state==='missing_key'?'Connection needed':connection.state==='error'?'Connection error':'Checking connection'}</strong><span>${escape(connection.message||'')}</span></div>`;
  }

  function renderReports() {
    const reports=ui.state?.reports||[];
    $('#report-count').textContent=reports.length;
    $('#reports').innerHTML=reports.map((report)=>`<button class="report-row ${report.id===ui.state?.view?.active_report_id?'active':''}" data-id="${escape(report.id)}"><span class="report-row-title">${escape(report.title)}</span><span class="report-row-meta"><i class="status ${escape(report.status)}"></i>${escape(statusLabel(report.status))} · ${new Date(report.updated_at).toLocaleDateString()}</span></button>`).join('')||'<p class="rail-empty">No reports yet.</p>';
    document.querySelectorAll('.report-row').forEach((button)=>button.addEventListener('click',()=>selectReport(button.dataset.id)));
  }

  function renderWorkflow() {
    const metadata=activeMetadata();
    const workflow=metadata?.workflow||null;
    const activities=(ui.state?.activities||[]).filter((item)=>item.report_id===metadata?.id).slice(0,4);
    const building=['queued','running','failed'].includes(workflow?.status);
    document.body.classList.toggle('workflow-is-building',building);
    window.WorkflowUI?.render($('#workflow'),workflow,{activities});
  }

  function renderAgentHelp() {
    const metadata=activeMetadata();
    const stalled=metadata?.status==='queued'&&!metadata?.workflow;
    const needsHelp=!metadata||stalled||metadata.status==='failed'||metadata.workflow?.status==='failed';
    $('#agent-help').hidden=!needsHelp;
  }

  function renderActivity() {
    const id=ui.state?.view?.active_report_id;
    const items=(ui.state?.activities||[]).filter((item)=>item.report_id===id).slice(0,20);
    const node=$('#activity');
    const details=$('#activity-details');
    details.hidden=!items.length;
    if(items.some((item)=>item.status==='running')||activeMetadata()?.workflow?.status==='running')details.open=true;
    node.hidden=!items.length;
    node.innerHTML=items.length?`<div class="activity-head"><div><span class="pulse ${items.some((item)=>item.status==='running')?'running':''}"></span><strong>Browser-safe local API calls</strong></div><span>${items.filter((item)=>item.status==='success').length} complete · ${items.filter((item)=>item.status==='running').length} running</span></div><div class="activity-list">${items.map((item)=>`<div class="activity-row"><span class="activity-icon ${escape(item.status)}"></span><div><strong>${escape(item.title)}</strong><span>${escape(item.detail)}</span></div>${item.duration_ms?`<time>${(item.duration_ms/1000).toFixed(1)}s</time>`:''}</div>`).join('')}</div>`:'';
  }

  function renderHeader() {
    const metadata=activeMetadata();
    if(!metadata)return;
    $('#report-title').textContent=metadata.title;
    $('#report-meta').textContent=`${statusLabel(metadata.status)} · revision ${metadata.revision} · updated ${new Date(metadata.updated_at).toLocaleString()}`;
  }

  async function selectReport(id, write=true) {
    if(write) await request('/api/view',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({active_report_id:id})});
    const body=await request(`/api/reports/${encodeURIComponent(id)}`);
    ui.report=body.report;
    $('#content').classList.remove('home-content');
    $('#report-title').textContent=body.report.title;
    $('#report-meta').textContent=`${statusLabel(body.report.status)} · revision ${body.report.revision} · updated ${new Date(body.report.updated_at).toLocaleString()}`;
    $('#content').innerHTML=`<article class="markdown-body">${body.rendered_html}</article>`;
    window.renderCampaignCharts?.($('#content'));
    ['copy','download'].forEach((buttonId)=>$(`#${buttonId}`).hidden=false);
    renderWorkflow(); renderActivity();
  }

  function renderState(state) {
    ui.state=state;
    renderConnection(); renderReports(); renderHeader(); renderWorkflow(); renderActivity(); renderAgentHelp();
    const active=state.view?.active_report_id;
    const metadata=activeMetadata();
    if(active && (!ui.report || ui.report.id!==active || ui.report.revision!==metadata?.revision)) selectReport(active,false).catch(()=>{});
  }

  async function refresh() { renderState(await request('/api/state')); }

  $('#copy').addEventListener('click',async()=>{if(!ui.report)return;await navigator.clipboard.writeText(ui.report.markdown);toast('Markdown copied.');});
  $('#download').addEventListener('click',()=>{if(!ui.report)return;const blob=new Blob([ui.report.markdown],{type:'text/markdown'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${ui.report.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'campaign-report'}.md`;a.click();URL.revokeObjectURL(a.href);});


  const events=new EventSource('/api/events/stream');
  events.addEventListener('state',(event)=>{try{renderState(JSON.parse(event.data));}catch{}});
  events.onerror=()=>{};
  setInterval(()=>refresh().catch(()=>{}),5000);
  refresh().catch((error)=>toast(error.message));
})();
