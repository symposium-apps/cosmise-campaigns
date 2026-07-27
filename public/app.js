(() => {
  const ui = { state: null, report: null };
  const $ = (selector) => document.querySelector(selector);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const statusLabel = (value) => ({ queued:'Preparing', writing:'Preparing', reviewing:'Final review', ready:'Ready', failed:'Needs help' }[value] || value || 'Draft');
  const updatedLabel = (value) => `Updated ${new Date(value).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}`;
  const BUILD_STAGES = [
    ['scope','Checking your campaign account'],
    ['models','Getting attribution options'],
    ['performance','Reviewing campaign performance'],
    ['trend','Looking for changes over time'],
    ['mapping','Checking campaign matching'],
    ['diagnostics','Reviewing data quality'],
    ['writing','Writing your report'],
    ['validation','Completing the final review'],
    ['complete','Report ready']
  ];
  const OPERATION_STAGE = { report_prepare:'scope', context:'scope', sources:'scope', capabilities:'models', performance:'performance', compare_attribution:'performance', trend:'trend', mapping:'mapping', diagnostics:'diagnostics', evidence:'performance', journey:'performance', report_write:'writing', report_validate:'validation', report_complete:'complete', report_fail:'complete' };
  const OPERATION_COPY = { report_prepare:'Preparing your report', context:'Checking campaign access', sources:'Checking campaign sources', capabilities:'Getting attribution options', performance:'Reviewing campaign performance', compare_attribution:'Comparing attribution results', trend:'Looking for changes over time', mapping:'Checking campaign matching', diagnostics:'Reviewing data quality', evidence:'Investigating campaign evidence', journey:'Reviewing customer journeys', report_write:'Writing your report', report_validate:'Completing the final review', report_complete:'Report ready', report_fail:'Report needs attention' };
  function toast(message) { const node=$('#toast'); node.textContent=message; node.hidden=false; clearTimeout(ui.toast); ui.toast=setTimeout(()=>node.hidden=true,3500); }
  async function request(url, options) { const response=await fetch(url,options); const body=await response.json().catch(()=>({})); if(!response.ok) throw new Error(body.error||'Request failed'); return body; }

  function activeMetadata() {
    const id=ui.state?.view?.active_report_id;
    return (ui.state?.reports||[]).find((report)=>report.id===id)||null;
  }

  function renderConnection() {
    const connection=ui.state?.connection||{};
    const copy=connection.state==='ready'
      ? ['Cosmise connected','Ready for campaign questions']
      : connection.state==='missing_key'
        ? ['Cosmise needs connecting','Ask your Agent for help']
        : connection.state==='error'
          ? ['Cosmise needs attention','Ask your Agent to check the connection']
          : ['Connecting to Cosmise','This should only take a moment'];
    $('#connection').innerHTML=`<span class="dot ${escape(connection.state)}"></span><div><strong>${copy[0]}</strong><span>${copy[1]}</span></div>`;
    const welcome=$('.welcome');
    if(welcome) {
      const heading=welcome.querySelector('h1');
      const description=welcome.querySelector('.welcome-copy');
      const suggestion=welcome.querySelector('.ask-chip');
      if(connection.state==='ready') {
        heading.textContent='Ask your Agent to create a campaign report';
        description.textContent='Cosmise is connected and ready. New reports appear here the moment your Agent starts working.';
        suggestion.textContent='“Which campaigns are bringing in the most revenue?”';
      } else if(connection.state==='missing_key'||connection.state==='error') {
        heading.textContent='Cosmise isn’t connected yet';
        description.textContent='Ask your Agent whether Cosmise Campaigns is ready. If it isn’t, the Agent can connect it for you.';
        suggestion.textContent='“Is Cosmise Campaigns ready?”';
      } else {
        heading.textContent='Connecting to Cosmise';
        description.textContent='This should only take a moment. Your reports will appear here when everything is ready.';
        suggestion.textContent='“Is Cosmise Campaigns ready?”';
      }
    }
  }

  function renderReports() {
    const reports=ui.state?.reports||[];
    $('#report-count').textContent=reports.length;
    $('#reports').innerHTML=reports.map((report)=>`<button class="report-row ${report.id===ui.state?.view?.active_report_id?'active':''}" data-id="${escape(report.id)}"><span class="report-row-title">${escape(report.title)}</span><span class="report-row-meta"><i class="status ${escape(report.status)}"></i>${escape(statusLabel(report.status))} · ${new Date(report.updated_at).toLocaleDateString()}</span></button>`).join('')||'<p class="rail-empty">No reports yet.</p>';
    document.querySelectorAll('.report-row').forEach((button)=>button.addEventListener('click',()=>selectReport(button.dataset.id)));
  }

  function renderWorkflow() {
    const metadata=activeMetadata();
    const rawActivities=(ui.state?.activities||[]).filter((item)=>item.report_id===metadata?.id).slice(0,4);
    const workflow=metadata?.workflow||derivedWorkflow(metadata,rawActivities);
    const activities=rawActivities.map((item,index)=>({ ...item, status:index===0&&workflow?.status==='running'?'running':item.status, title:OPERATION_COPY[item.operation]||item.title||'Working on your report', detail:index===0&&workflow?.status==='running'?'Working now':item.status==='failed'?'Needs attention':'Complete' }));
    const building=['queued','running','failed'].includes(workflow?.status);
    document.body.classList.toggle('workflow-is-building',building);
    window.WorkflowUI?.render($('#workflow'),workflow,{activities});
  }

  function derivedWorkflow(metadata,activities) {
    if(!metadata||metadata.status==='ready')return null;
    const failed=metadata.status==='failed';
    const latest=activities[0];
    const currentId=OPERATION_STAGE[latest?.operation]||'scope';
    const currentIndex=Math.max(0,BUILD_STAGES.findIndex(([id])=>id===currentId));
    const stages=BUILD_STAGES.map(([id,label],index)=>({ id,label,status:failed&&index===currentIndex?'failed':index<currentIndex?'success':index===currentIndex?'running':'pending',detail:index===currentIndex?(OPERATION_COPY[latest?.operation]||'Working on your report'):'',progress:null }));
    return { status:failed?'failed':'running', current_stage:currentId, percent:Math.max(8,Math.round(((currentIndex+.25)/BUILD_STAGES.length)*100)), summary:failed?'Your report needs attention':OPERATION_COPY[latest?.operation]||'Your Agent is preparing the report', stages };
  }

  function renderAgentHelp() {
    const metadata=activeMetadata();
    const latest=(ui.state?.activities||[]).find((item)=>item.report_id===metadata?.id);
    const latestAt=Date.parse(latest?.updated_at||metadata?.updated_at||0);
    const stalled=metadata?.status==='queued'&&!metadata?.workflow&&Date.now()-latestAt>180000;
    const needsHelp=stalled||metadata?.status==='failed'||metadata?.workflow?.status==='failed';
    $('#agent-help').hidden=!needsHelp;
  }


  function renderHeader() {
    const metadata=activeMetadata();
    $('#toolbar').hidden=!metadata;
    if(!metadata)return;
    $('#report-title').textContent=metadata.title;
    $('#report-meta').textContent=`${statusLabel(metadata.status)} · ${updatedLabel(metadata.updated_at)}`;
  }

  async function selectReport(id, write=true) {
    if(write) await request('/api/view',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({active_report_id:id})});
    const body=await request(`/api/reports/${encodeURIComponent(id)}`);
    ui.report=body.report;
    $('#toolbar').hidden=false;
    $('#content').classList.remove('home-content');
    $('#report-title').textContent=body.report.title;
    $('#report-meta').textContent=`${statusLabel(body.report.status)} · ${updatedLabel(body.report.updated_at)}`;
    $('#content').innerHTML=`<article class="markdown-body">${body.rendered_html}</article>`;
    window.renderCampaignCharts?.($('#content'));
    ['copy','download'].forEach((buttonId)=>$(`#${buttonId}`).hidden=body.report.status!=='ready');
    renderWorkflow();
  }

  function renderState(state) {
    ui.state=state;
    renderConnection(); renderReports(); renderHeader(); renderWorkflow(); renderAgentHelp();
    const active=state.view?.active_report_id;
    const metadata=activeMetadata();
    if(active && (!ui.report || ui.report.id!==active || ui.report.revision!==metadata?.revision)) selectReport(active,false).catch(()=>{});
  }

  async function refresh() { renderState(await request('/api/state')); }

  $('#copy').addEventListener('click',async()=>{if(!ui.report)return;await navigator.clipboard.writeText(ui.report.markdown);toast('Report copied.');});
  $('#download').addEventListener('click',()=>{if(!ui.report)return;const blob=new Blob([ui.report.markdown],{type:'text/markdown'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${ui.report.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'campaign-report'}.md`;a.click();URL.revokeObjectURL(a.href);});


  const events=new EventSource('/api/events/stream');
  events.addEventListener('state',(event)=>{try{renderState(JSON.parse(event.data));}catch{}});
  events.onerror=()=>{};
  setInterval(()=>refresh().catch(()=>{}),5000);
  refresh().catch((error)=>toast(error.message));
})();
